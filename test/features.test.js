import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  analyzeRepository,
  analyzeSupplyChain,
  compileGlob,
  diffApiSurface,
  evaluatePolicy,
  loadPolicy,
  parseCargoDependencies,
  parsePyprojectDependencies,
  parseRequirements,
  toMermaid,
  validatePolicy
} from "../packages/core/src/index.js";
import { startWatch } from "../packages/core/src/watch.js";
import { maskJavaScriptSource } from "../packages/core/src/extractors/source-masker.js";

test("source masker neutralizes import-like keywords inside strings and comments", () => {
  const source = [
    "// import fakeFromComment from 'comment';",
    "const literal = \"import bogus from 'string'\";",
    "/* function notRealFunction() {} */",
    "export function realFunction() { return 1; }"
  ].join("\n");
  const masked = maskJavaScriptSource(source);

  assert.equal(masked.length, source.length);
  assert.ok(!/import\s+fakeFromComment/.test(masked), "masked source should hide commented imports");
  assert.ok(!/import\s+bogus/.test(masked), "masked source should hide imports inside string literals");
  assert.ok(!/notRealFunction/.test(masked), "masked source should hide block-comment identifiers");
  assert.match(masked, /export function realFunction/);
});

test("javascript extractor ignores false-positive symbols inside strings and comments", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "repograph-mask-"));
  await mkdir(path.join(repoPath, "src"));
  await writeFile(
    path.join(repoPath, "src", "decoy.ts"),
    [
      "// export function fakeFromComment() {}",
      "const sample = \"export class FakeFromString {}\";",
      "export default class RealClass {",
      "  run() { return sample; }",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const graph = await analyzeRepository(repoPath);
  const fileNode = graph.nodes.find((node) => node.id === "file:src/decoy.ts");

  assert.ok(fileNode, "file node should be present");
  const symbolLabels = graph.nodes
    .filter((node) => node.path === "src/decoy.ts" && node.type !== "file")
    .map((node) => node.label);

  assert.ok(symbolLabels.includes("RealClass"), "RealClass should be detected as a symbol");
  assert.ok(symbolLabels.includes("run"), "method run should be detected");
  assert.ok(!symbolLabels.includes("fakeFromComment"), "comment-only symbol should be ignored");
  assert.ok(!symbolLabels.includes("FakeFromString"), "string-only symbol should be ignored");
  await rm(repoPath, { recursive: true, force: true });
});

test("supply chain audit parses npm manifests and emits findings without network", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "repograph-supply-"));
  await writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      dependencies: {
        express: "^4.0.0",
        "left-pad": ""
      }
    }, null, 2),
    "utf8"
  );

  const report = await analyzeSupplyChain(repoPath);
  assert.equal(report.online, false);
  assert.equal(report.dependencyCount, 2);
  assert.ok(report.manifests.some((manifest) => manifest.ecosystem === "npm"));
  assert.ok(report.findings.some((finding) => finding.type === "unpinned_dependency" && finding.name === "left-pad"));
  await rm(repoPath, { recursive: true, force: true });
});

test("supply chain audit can hit OSV via injected fetch and surfaces vulnerabilities", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "repograph-supply-osv-"));
  await writeFile(
    path.join(repoPath, "package.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      dependencies: { express: "4.0.0" }
    }, null, 2),
    "utf8"
  );

  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      async json() {
        return {
          results: [{
            vulns: [{
              id: "GHSA-test",
              summary: "Test advisory",
              severity: [{ score: "HIGH" }]
            }]
          }]
        };
      }
    };
  };

  const report = await analyzeSupplyChain(repoPath, { online: true, fetch: fakeFetch });
  assert.ok(captured, "fetch should be invoked");
  assert.equal(captured.body.queries[0].package.name, "express");
  const advisoryFinding = report.findings.find((finding) => finding.type === "vulnerable_dependency");
  assert.ok(advisoryFinding, "advisory finding should exist");
  assert.equal(advisoryFinding.advisories[0].id, "GHSA-test");
  await rm(repoPath, { recursive: true, force: true });
});

test("supply chain manifest parsers handle Cargo, requirements, and pyproject", () => {
  const cargo = parseCargoDependencies([
    "[package]",
    "name = \"app\"",
    "[dependencies]",
    "serde = \"1.2.3\"",
    "tokio = { version = \"1.30.0\", features = [\"full\"] }"
  ].join("\n"));
  assert.equal(cargo.length, 2);
  assert.equal(cargo[0].name, "serde");
  assert.equal(cargo[1].version, "1.30.0");

  const requirements = parseRequirements("Django==4.2.7\n# comment\nrequests>=2.31.0\n");
  assert.equal(requirements.length, 2);
  assert.equal(requirements[0].name, "Django");
  assert.equal(requirements[0].version, "4.2.7");

  const pyproject = parsePyprojectDependencies([
    "[project]",
    "name = \"demo\"",
    "dependencies = [",
    "  \"flask>=2.0\",",
    "  \"pydantic==1.10.0\"",
    "]"
  ].join("\n"));
  assert.equal(pyproject.length, 2);
  assert.equal(pyproject[1].name, "pydantic");
  assert.equal(pyproject[1].version, "1.10.0");
});

test("watch mode emits initial graph and rebuilds after file changes", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "repograph-watch-"));
  await mkdir(path.join(repoPath, "src"));
  await writeFile(path.join(repoPath, "src", "alpha.ts"), "export function alpha() { return 1; }\n", "utf8");

  const events = [];
  const stop = await startWatch(repoPath, {
    debounceMs: 60,
    onUpdate: (event) => {
      events.push({ type: event.type, files: event.metrics?.files ?? null });
    }
  });

  try {
    assert.ok(events.find((event) => event.type === "ready"), "ready event should fire");
    await delay(80);
    await writeFile(path.join(repoPath, "src", "beta.ts"), "export function beta() { return 2; }\n", "utf8");

    const updated = await waitFor(() => events.find((event) => event.type === "updated"), 4000);
    assert.ok(updated, "updated event should fire after change");
    const graphRaw = await readFile(path.join(repoPath, ".repograph", "graph.json"), "utf8");
    const graph = JSON.parse(graphRaw);
    assert.ok(graph.nodes.some((node) => node.id === "file:src/beta.ts"));
  } finally {
    await stop();
    await rm(repoPath, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) {
      return value;
    }
    await delay(40);
  }
  return null;
}

const mermaidFixtureGraph = {
  version: 1,
  generatedAt: "fixture",
  root: "fixture",
  nodes: [
    { id: "file:src/index.ts", type: "file", label: "index.ts", path: "src/index.ts", language: "typescript" },
    { id: "file:src/util.ts", type: "file", label: "util.ts", path: "src/util.ts", language: "typescript" },
    { id: "package:express", type: "package", label: "express" },
    { id: "function:src/util.ts:doThing", type: "function", label: "doThing", path: "src/util.ts" }
  ],
  edges: [
    { id: "e1", type: "imports", from: "file:src/index.ts", to: "file:src/util.ts", scope: "internal" },
    { id: "e2", type: "dependency", from: "file:src/index.ts", to: "package:express", scope: "external" },
    { id: "e3", type: "contains", from: "file:src/util.ts", to: "function:src/util.ts:doThing", scope: "internal" }
  ]
};

test("toMermaid renders flowchart with files and packages by default", () => {
  const mermaid = toMermaid(mermaidFixtureGraph);

  assert.match(mermaid, /^flowchart LR\n/);
  assert.match(mermaid, /classDef file fill:#dbeafe/);
  assert.match(mermaid, /classDef package fill:#e2e8f0/);
  assert.match(mermaid, /\["index\.ts"\]:::file/);
  assert.match(mermaid, /\["util\.ts"\]:::file/);
  assert.match(mermaid, /\(\["express"\]\):::package/);
  assert.match(mermaid, /n1 --> n2/);
  assert.match(mermaid, /n1 -\.-> n3/);
  assert.ok(!mermaid.includes("doThing"), "symbol nodes should be excluded by default");
  assert.ok(!mermaid.includes("---"), "contains edges should be excluded by default");
});

test("toMermaid honors direction, symbols, and no-packages options", () => {
  const mermaid = toMermaid(mermaidFixtureGraph, {
    direction: "TD",
    includeSymbols: true,
    includePackages: false,
    includeContains: true
  });

  assert.match(mermaid, /^flowchart TD\n/);
  assert.match(mermaid, /doThing/);
  assert.match(mermaid, /:::symbol/);
  assert.ok(!mermaid.includes("express"), "package nodes should be excluded when includePackages=false");
  assert.match(mermaid, / --- /);
});

test("toMermaid truncates large graphs and annotates the cap", () => {
  const nodes = [];
  const edges = [];
  for (let index = 0; index < 50; index += 1) {
    nodes.push({ id: `file:f${index}.ts`, type: "file", label: `f${index}.ts`, path: `f${index}.ts` });
  }
  for (let index = 0; index < 30; index += 1) {
    edges.push({ id: `e${index}`, type: "imports", from: `file:f${index}.ts`, to: `file:f${index + 1}.ts`, scope: "internal" });
  }
  const graph = { version: 1, generatedAt: "t", root: "t", nodes, edges };

  const mermaid = toMermaid(graph, { maxNodes: 10, maxEdges: 5 });

  const nodeMatches = mermaid.match(/^  n\d+\["/gm) ?? [];
  assert.equal(nodeMatches.length, 10);
  assert.match(mermaid, /Truncated:/);
  assert.match(mermaid, /nodes 10\/50/);
  assert.match(mermaid, /edges capped at 5/);
});

test("toMermaid escapes quotes, angle brackets, and trims long labels", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:weird.ts", type: "file", label: "weird \"name\" <html>", path: "weird.ts" },
      {
        id: "package:long",
        type: "package",
        label: "x".repeat(120)
      }
    ],
    edges: []
  };

  const mermaid = toMermaid(graph);

  assert.ok(!/[^\\]"[^,:]]/.test(mermaid) || /\\"/.test(mermaid), "quotes should be escaped");
  assert.ok(!mermaid.includes("<html>"), "angle brackets should be stripped or replaced");
  assert.match(mermaid, /…"/, "long labels should be truncated with an ellipsis");
});

test("toMermaid throws on missing graph or malformed input", () => {
  assert.throws(() => toMermaid(null), /requires a graph/);
  assert.throws(() => toMermaid({}), /requires a graph/);
  assert.throws(() => toMermaid({ nodes: [], edges: "nope" }), /requires a graph/);
});

const policyFixtureGraph = {
  version: 1,
  generatedAt: "fixture",
  root: "fixture",
  nodes: [
    { id: "file:src/domain/user.ts", type: "file", path: "src/domain/user.ts", lineCount: 50, importCount: 3 },
    { id: "file:src/domain/order.ts", type: "file", path: "src/domain/order.ts", lineCount: 700, importCount: 4 },
    { id: "file:src/infra/db.ts", type: "file", path: "src/infra/db.ts", lineCount: 100, importCount: 2 },
    { id: "file:src/util/big.ts", type: "file", path: "src/util/big.ts", lineCount: 200, importCount: 30 },
    { id: "package:@aws-sdk/client-s3", type: "package", label: "@aws-sdk/client-s3" }
  ],
  edges: [
    { id: "e1", type: "imports", from: "file:src/domain/user.ts", to: "file:src/infra/db.ts", scope: "internal" },
    { id: "e2", type: "imports", from: "file:src/domain/order.ts", to: "file:src/domain/user.ts", scope: "internal" },
    { id: "e3", type: "imports", from: "file:src/domain/user.ts", to: "file:src/domain/order.ts", scope: "internal" },
    { id: "e4", type: "dependency", from: "file:src/util/big.ts", to: "package:@aws-sdk/client-s3", scope: "external" }
  ]
};

test("compileGlob handles **, *, ?, and literal paths", () => {
  assert.ok(compileGlob("src/**")("src/a/b.ts"));
  assert.ok(compileGlob("src/**")("src/a.ts"));
  assert.ok(!compileGlob("src/**")("lib/a.ts"));
  assert.ok(compileGlob("src/*.ts")("src/a.ts"));
  assert.ok(!compileGlob("src/*.ts")("src/sub/a.ts"));
  assert.ok(compileGlob("src/file?.ts")("src/file1.ts"));
  assert.ok(!compileGlob("src/file?.ts")("src/file12.ts"));
  assert.ok(compileGlob("**")("anything/at/all"));
  assert.ok(compileGlob("@aws-sdk/*")("@aws-sdk/client-s3"));
});

test("validatePolicy rejects malformed input and accepts well-formed rules", () => {
  assert.throws(() => validatePolicy(null), /Policy must be an object/);
  assert.throws(() => validatePolicy({ rules: "nope" }), /'rules' array/);
  assert.throws(() => validatePolicy({ rules: [{ id: "a", type: "what" }] }), /unsupported type/);
  assert.throws(() => validatePolicy({ rules: [{ id: "a", type: "max-lines", target: "**" }] }), /requires positive integer field 'limit'/);
  assert.throws(() => validatePolicy({ rules: [
    { id: "dup", type: "no-cycles" },
    { id: "dup", type: "no-cycles" }
  ] }), /Duplicate rule id/);

  const ok = validatePolicy({ rules: [{ id: "r1", type: "max-lines", target: "src/**", limit: 100 }] });
  assert.equal(ok.rules.length, 1);
  assert.equal(ok.rules[0].severity, "error");
});

test("evaluatePolicy detects forbid-import, max-lines, max-imports, and forbid-dependency violations", () => {
  const policy = validatePolicy({
    rules: [
      { id: "no-domain-into-infra", type: "forbid-import", severity: "error", from: "src/domain/**", to: "src/infra/**" },
      { id: "small-files", type: "max-lines", severity: "warning", target: "src/**", limit: 500 },
      { id: "bounded-imports", type: "max-imports", severity: "warning", target: "src/util/**", limit: 10 },
      { id: "no-aws", type: "forbid-dependency", severity: "error", from: "src/util/**", to: "@aws-sdk/*" }
    ]
  });

  const report = evaluatePolicy(policyFixtureGraph, policy);

  assert.equal(report.passed, false);
  const ids = report.violations.map((violation) => violation.ruleId);
  assert.ok(ids.includes("no-domain-into-infra"));
  assert.ok(ids.includes("small-files"));
  assert.ok(ids.includes("bounded-imports"));
  assert.ok(ids.includes("no-aws"));
  assert.equal(report.counts.error, 2);
  assert.equal(report.counts.warning, 2);
});

test("evaluatePolicy reports no-cycles within a scope and dedupes rotated cycles", () => {
  const policy = validatePolicy({
    rules: [{ id: "no-domain-cycles", type: "no-cycles", severity: "error", scope: "src/domain/**" }]
  });

  const report = evaluatePolicy(policyFixtureGraph, policy);
  const cycleViolations = report.violations.filter((violation) => violation.ruleId === "no-domain-cycles");
  assert.equal(cycleViolations.length, 1, "rotated cycles should be deduplicated to a single violation");
  assert.match(cycleViolations[0].message, /Cycle detected within 'src\/domain\/\*\*'/);
});

test("evaluatePolicy passed flag respects failOn threshold", () => {
  const policy = validatePolicy({
    rules: [{ id: "size-warn", type: "max-lines", severity: "warning", target: "src/**", limit: 100 }]
  });

  const errorReport = evaluatePolicy(policyFixtureGraph, policy, { failOn: "error" });
  assert.equal(errorReport.passed, true, "warnings should not fail when failOn=error");

  const warningReport = evaluatePolicy(policyFixtureGraph, policy, { failOn: "warning" });
  assert.equal(warningReport.passed, false, "warnings should fail when failOn=warning");
});

test("loadPolicy reads, parses, and validates a .json policy file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "repograph-policy-"));
  const policyPath = path.join(dir, "policy.json");
  await writeFile(
    policyPath,
    JSON.stringify({
      version: 1,
      rules: [{ id: "r1", type: "max-lines", target: "**", limit: 200 }]
    }),
    "utf8"
  );

  const policy = await loadPolicy(policyPath);
  assert.equal(policy.rules.length, 1);

  const badPath = path.join(dir, "bad.yaml");
  await writeFile(badPath, "noop", "utf8");
  await assert.rejects(() => loadPolicy(badPath), /must use a \.json extension/);

  await rm(dir, { recursive: true, force: true });
});

function buildExportGraph(spec) {
  const nodes = [];
  const edges = [];
  for (const file of spec) {
    nodes.push({ id: `file:${file.path}`, type: "file", path: file.path, label: file.path });
    for (const exp of file.exports) {
      const symbolId = `symbol:${file.path}:${exp.name}`;
      nodes.push({ id: symbolId, type: exp.type, label: exp.name, path: file.path });
      edges.push({
        id: `exports:file:${file.path}->${symbolId}`,
        type: "exports",
        from: `file:${file.path}`,
        to: symbolId,
        exportedName: exp.name
      });
    }
  }
  return { version: 1, generatedAt: "fixture", root: "fixture", nodes, edges };
}

test("diffApiSurface classifies added, removed, and changed exports", () => {
  const base = buildExportGraph([
    { path: "src/a.ts", exports: [{ name: "stay", type: "function" }, { name: "kill", type: "function" }] },
    { path: "src/b.ts", exports: [{ name: "morph", type: "function" }] }
  ]);
  const head = buildExportGraph([
    { path: "src/a.ts", exports: [{ name: "stay", type: "function" }, { name: "born", type: "function" }] },
    { path: "src/b.ts", exports: [{ name: "morph", type: "class" }] }
  ]);

  const report = diffApiSurface(base, head);

  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.removed, 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.breaking, 2);
  assert.deepEqual(report.added.map((entry) => entry.name), ["born"]);
  assert.deepEqual(report.removed.map((entry) => entry.name), ["kill"]);
  assert.equal(report.changed[0].baseType, "function");
  assert.equal(report.changed[0].headType, "class");
});

test("diffApiSurface flags whole new and deleted files with exports", () => {
  const base = buildExportGraph([
    { path: "src/old.ts", exports: [{ name: "x", type: "function" }] }
  ]);
  const head = buildExportGraph([
    { path: "src/new.ts", exports: [{ name: "y", type: "function" }] }
  ]);

  const report = diffApiSurface(base, head);

  assert.deepEqual(report.addedFiles, ["src/new.ts"]);
  assert.deepEqual(report.removedFiles, ["src/old.ts"]);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.removed, 1);
});

test("diffApiSurface groups violations by file when includeFileSummary is on", () => {
  const base = buildExportGraph([
    { path: "src/a.ts", exports: [{ name: "old1", type: "function" }, { name: "old2", type: "function" }] }
  ]);
  const head = buildExportGraph([
    { path: "src/a.ts", exports: [{ name: "new1", type: "function" }] }
  ]);

  const report = diffApiSurface(base, head);

  assert.equal(report.byFile.length, 1);
  assert.equal(report.byFile[0].path, "src/a.ts");
  assert.equal(report.byFile[0].added.length, 1);
  assert.equal(report.byFile[0].removed.length, 2);
});

test("diffApiSurface returns empty diff for identical graphs and accepts disabling byFile", () => {
  const graph = buildExportGraph([
    { path: "src/a.ts", exports: [{ name: "stay", type: "function" }] }
  ]);

  const report = diffApiSurface(graph, graph, { includeFileSummary: false });

  assert.equal(report.summary.added, 0);
  assert.equal(report.summary.removed, 0);
  assert.equal(report.summary.changed, 0);
  assert.equal(report.summary.breaking, 0);
  assert.ok(!("byFile" in report), "byFile should be omitted when includeFileSummary is false");
});

test("diffApiSurface trims whitespace in export names and skips entries with empty path or name", () => {
  const base = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/a.ts", type: "file", path: "src/a.ts", label: "a.ts" },
      { id: "symbol:src/a.ts:padded", type: "function", label: "padded", path: "src/a.ts" },
      { id: "file:phantom", type: "file", path: "", label: "" },
      { id: "symbol:phantom:noop", type: "function", label: "noop", path: "" }
    ],
    edges: [
      { id: "e1", type: "exports", from: "file:src/a.ts", to: "symbol:src/a.ts:padded", exportedName: "  padded  " },
      { id: "e2", type: "exports", from: "file:phantom", to: "symbol:phantom:noop", exportedName: "noop" },
      { id: "e3", type: "exports", from: "file:src/a.ts", to: "symbol:src/a.ts:padded", exportedName: "   " }
    ]
  };
  const head = buildExportGraph([]);

  const report = diffApiSurface(base, head);

  assert.equal(report.summary.removed, 1, "padded should be the only counted export");
  assert.equal(report.removed[0].name, "padded", "trim() result should be stored");
  assert.ok(!report.removedFiles.includes(""), "empty-path file should be skipped, not surface in removedFiles");
});

test("diffApiSurface marks same-file same-name duplicate exports with conflicting symbol types", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/a.ts", type: "file", path: "src/a.ts", label: "a.ts" },
      { id: "symbol:src/a.ts:doThing:fn", type: "function", label: "doThing", path: "src/a.ts" },
      { id: "symbol:src/a.ts:doThing:cls", type: "class", label: "doThing", path: "src/a.ts" }
    ],
    edges: [
      { id: "e1", type: "exports", from: "file:src/a.ts", to: "symbol:src/a.ts:doThing:fn", exportedName: "doThing" },
      { id: "e2", type: "exports", from: "file:src/a.ts", to: "symbol:src/a.ts:doThing:cls", exportedName: "doThing" }
    ]
  };

  // Self-diff to inspect surface collection: both base and head see one entry with conflict=true.
  const report = diffApiSurface(graph, graph);
  assert.equal(report.summary.added, 0);
  assert.equal(report.summary.removed, 0);
  assert.equal(report.summary.changed, 0);

  // Asymmetric diff: same conflict on base, head has only the function form. The classification
  // should still see them as the "same" export (no false removal of the class form).
  const headOnlyFn = {
    ...graph,
    edges: [graph.edges[0]]
  };
  const asymmetric = diffApiSurface(graph, headOnlyFn);
  assert.equal(asymmetric.summary.removed, 0, "duplicate-collapsed exports should not produce a phantom removal");
});

test("diffApiSurface throws on malformed input", () => {
  const good = buildExportGraph([]);
  assert.throws(() => diffApiSurface(null, good), /baseGraph must be a RepoGraph/);
  assert.throws(() => diffApiSurface(good, {}), /headGraph must be a RepoGraph/);
  assert.throws(() => diffApiSurface(good, { nodes: [], edges: "no" }), /headGraph must be a RepoGraph/);
});

test("toMermaid escapes pipes, backticks, and braces in labels to keep flowchart syntax safe", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:weird.ts", type: "file", label: "a|b `c` {d} e", path: "weird.ts" }
    ],
    edges: []
  };

  const mermaid = toMermaid(graph);

  assert.ok(!mermaid.includes("a|b"), "pipe should not survive escaping");
  assert.ok(!/`/.test(mermaid.split("\n").filter((line) => line.includes("weird")).join("")), "backticks should not appear inside node labels");
  assert.ok(!mermaid.includes("{d}"), "curly braces should not appear inside node labels");
  assert.match(mermaid, /a\/b/, "pipe should be replaced with forward slash");
});
