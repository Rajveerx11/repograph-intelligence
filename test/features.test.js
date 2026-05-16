import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  analyzeRepository,
  analyzeSupplyChain,
  applyCoverageToGraph,
  compileGlob,
  diffApiSurface,
  evaluatePolicy,
  loadLcov,
  loadPolicy,
  parseCargoDependencies,
  parseLcov,
  parsePyprojectDependencies,
  parseRequirements,
  createGraphSnapshot,
  detectDrift,
  rankByCoverageRisk,
  selectTests,
  toDot,
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

test("toDot renders a digraph with files and packages by default", () => {
  const dot = toDot(mermaidFixtureGraph);

  assert.match(dot, /^digraph RepoGraph \{\n/);
  assert.match(dot, /rankdir=LR;/);
  assert.match(dot, /n1 \[label="index\.ts"/);
  assert.match(dot, /n3 \[label="express"/);
  assert.match(dot, /shape=ellipse, fillcolor="#e2e8f0"/);
  assert.match(dot, /n1 -> n2;/);
  assert.match(dot, /n1 -> n3 \[style=dashed/);
});

test("toDot accepts TD as a Mermaid-style alias for TB and rejects unknown rankdirs", () => {
  const dot = toDot(mermaidFixtureGraph, { rankdir: "TD" });
  assert.match(dot, /rankdir=TB;/, "TD should be normalised to TB so users can share flags with the mermaid command");

  assert.throws(() => toDot(mermaidFixtureGraph, { rankdir: "DIAGONAL" }), /rankdir must be one of/);
});

test("toDot escapes quotes, backslashes, control characters, and trims long labels", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:weird.ts", type: "file", label: "a\"b\\c\nde", path: "weird.ts" },
      { id: "package:long", type: "package", label: "x".repeat(120) }
    ],
    edges: []
  };

  const dot = toDot(graph);

  // Inside a DOT quoted string, `\\` and `\"` are valid escapes; the source
  // should contain those sequences and never bare control characters.
  assert.match(dot, /a\\"b\\\\c d e/, "quote, backslash, newline, and control chars should be escaped or stripped");
  assert.match(dot, /…"/, "long labels should be truncated with an ellipsis");
});

test("toDot truncates large graphs and annotates the cap as a DOT comment", () => {
  const nodes = [];
  const edges = [];
  for (let index = 0; index < 50; index += 1) {
    nodes.push({ id: `file:f${index}.ts`, type: "file", label: `f${index}.ts`, path: `f${index}.ts` });
  }
  for (let index = 0; index < 30; index += 1) {
    edges.push({ id: `e${index}`, type: "imports", from: `file:f${index}.ts`, to: `file:f${index + 1}.ts`, scope: "internal" });
  }
  const graph = { version: 1, generatedAt: "t", root: "t", nodes, edges };

  const dot = toDot(graph, { maxNodes: 10, maxEdges: 5 });
  const nodeMatches = dot.match(/^  n\d+ \[label/gm) ?? [];
  assert.equal(nodeMatches.length, 10);
  assert.match(dot, /\/\/ Truncated: nodes 10\/50, edges capped at 5\./);
});

test("toDot throws on missing or malformed graphs", () => {
  assert.throws(() => toDot(null), /requires a graph/);
  assert.throws(() => toDot({}), /requires a graph/);
  assert.throws(() => toDot({ nodes: [], edges: "nope" }), /requires a graph/);
});

test("toDot renders symbol and module nodes when includeSymbols and includeContains are set", () => {
  const dot = toDot(mermaidFixtureGraph, {
    includeSymbols: true,
    includePackages: false,
    includeContains: true
  });

  assert.match(dot, /doThing/, "symbol nodes should appear when includeSymbols=true");
  assert.match(dot, /fillcolor="#dcfce7"/, "function/method/class symbols should use the green palette");
  assert.ok(!dot.includes("express"), "package nodes should be omitted when includePackages=false");
  assert.match(dot, /arrowhead=none/, "contains edges should render with the undirected arrow style when includeContains=true");
});

test("toDot encodes export and reference edge types with their distinct styles", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/a.ts", type: "file", path: "src/a.ts", label: "a.ts" },
      { id: "file:src/b.ts", type: "file", path: "src/b.ts", label: "b.ts" },
      { id: "file:src/c.ts", type: "file", path: "src/c.ts", label: "c.ts" }
    ],
    edges: [
      { id: "e1", type: "exports", from: "file:src/a.ts", to: "file:src/b.ts", scope: "internal" },
      { id: "e2", type: "references", from: "file:src/a.ts", to: "file:src/c.ts", scope: "internal" }
    ]
  };

  const dot = toDot(graph, { includeContains: true });

  assert.match(dot, /penwidth=2, color="#16a34a"/, "exports edges should render in bold green");
  assert.match(dot, /style=dotted, label="ref"/, "references edges should be dotted with a ref label");
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

test("evaluatePolicy fires require-import when the importing file has no matching import edge", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/handlers/user.ts", type: "file", path: "src/handlers/user.ts" },
      { id: "file:src/handlers/order.ts", type: "file", path: "src/handlers/order.ts" },
      { id: "file:src/auth.ts", type: "file", path: "src/auth.ts" }
    ],
    edges: [
      { id: "e1", type: "imports", from: "file:src/handlers/user.ts", to: "file:src/auth.ts", scope: "internal" }
    ]
  };
  const policy = validatePolicy({
    rules: [{ id: "auth-required", type: "require-import", severity: "error", from: "src/handlers/**", to: "src/auth.ts" }]
  });

  const report = evaluatePolicy(graph, policy);
  const violations = report.violations.filter((violation) => violation.ruleId === "auth-required");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].target, "src/handlers/order.ts");
});

test("evaluatePolicy enforces max-fan-in by counting incoming import edges per file", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/util.ts", type: "file", path: "src/util.ts" },
      { id: "file:src/a.ts", type: "file", path: "src/a.ts" },
      { id: "file:src/b.ts", type: "file", path: "src/b.ts" },
      { id: "file:src/c.ts", type: "file", path: "src/c.ts" }
    ],
    edges: [
      { id: "e1", type: "imports", from: "file:src/a.ts", to: "file:src/util.ts", scope: "internal" },
      { id: "e2", type: "imports", from: "file:src/b.ts", to: "file:src/util.ts", scope: "internal" },
      { id: "e3", type: "imports", from: "file:src/c.ts", to: "file:src/util.ts", scope: "internal" }
    ]
  };
  const policy = validatePolicy({
    rules: [{ id: "util-fan-in", type: "max-fan-in", severity: "warning", target: "src/util.ts", limit: 2 }]
  });

  const report = evaluatePolicy(graph, policy);
  const violation = report.violations.find((entry) => entry.ruleId === "util-fan-in");
  assert.ok(violation, "fan-in 3 exceeds limit 2");
  assert.equal(violation.actual, 3);
});

test("evaluatePolicy detects layered violations when an import flows upward against declared order", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/ui/Button.tsx", type: "file", path: "src/ui/Button.tsx" },
      { id: "file:src/app/Routes.tsx", type: "file", path: "src/app/Routes.tsx" },
      { id: "file:src/domain/User.ts", type: "file", path: "src/domain/User.ts" }
    ],
    edges: [
      // OK: ui (layer 0) imports app (layer 1)
      { id: "e1", type: "imports", from: "file:src/ui/Button.tsx", to: "file:src/app/Routes.tsx", scope: "internal" },
      // VIOLATION: domain (layer 2) imports app (layer 1) — upward
      { id: "e2", type: "imports", from: "file:src/domain/User.ts", to: "file:src/app/Routes.tsx", scope: "internal" }
    ]
  };
  const policy = validatePolicy({
    rules: [{
      id: "hex-layering",
      type: "layered",
      severity: "error",
      layers: [
        { name: "ui", glob: "src/ui/**" },
        { name: "app", glob: "src/app/**" },
        { name: "domain", glob: "src/domain/**" }
      ]
    }]
  });

  const report = evaluatePolicy(graph, policy);
  const layerViolations = report.violations.filter((entry) => entry.ruleId === "hex-layering");
  assert.equal(layerViolations.length, 1);
  assert.equal(layerViolations[0].fromLayer, "domain");
  assert.equal(layerViolations[0].toLayer, "app");
});

test("evaluatePolicy applies naming-convention against basename by default and falls through to path when configured", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/components/Button.tsx", type: "file", path: "src/components/Button.tsx" },
      { id: "file:src/components/badComponentName.tsx", type: "file", path: "src/components/badComponentName.tsx" },
      { id: "file:src/components/helper-fn.tsx", type: "file", path: "src/components/helper-fn.tsx" }
    ],
    edges: []
  };
  const policy = validatePolicy({
    rules: [{
      id: "component-pascal-case",
      type: "naming-convention",
      severity: "warning",
      target: "src/components/**",
      pattern: "^[A-Z][A-Za-z0-9]*\\.tsx$"
    }]
  });

  const report = evaluatePolicy(graph, policy);
  const namingViolations = report.violations.filter((entry) => entry.ruleId === "component-pascal-case");
  assert.equal(namingViolations.length, 2, "lowercase and kebab-case file names should both fail");
  assert.ok(namingViolations.some((v) => v.target.endsWith("badComponentName.tsx")));
  assert.ok(namingViolations.some((v) => v.target.endsWith("helper-fn.tsx")));
});

test("validatePolicy rejects malformed layered, require-import, and naming-convention rules", () => {
  assert.throws(() => validatePolicy({ rules: [{ id: "x", type: "layered" }] }), /'layers' array with at least two entries/);
  assert.throws(() => validatePolicy({ rules: [{ id: "x", type: "layered", layers: [{ name: "a", glob: "**" }] }] }), /'layers' array with at least two entries/);
  assert.throws(() => validatePolicy({ rules: [{ id: "x", type: "layered", layers: [{ name: "a", glob: "**" }, { name: "a", glob: "src/**" }] }] }), /duplicate layer name/);
  assert.throws(() => validatePolicy({ rules: [{ id: "x", type: "require-import", from: "**" }] }), /requires string field 'to'/);
  assert.throws(() => validatePolicy({ rules: [{ id: "x", type: "naming-convention", target: "**", pattern: "(unclosed" }] }), /not a valid regular expression/);
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

const sampleLcov = [
  "TN:",
  "SF:src/a.ts",
  "FN:5,doThing",
  "FNDA:1,doThing",
  "FNF:2",
  "FNH:1",
  "DA:1,1",
  "DA:2,1",
  "DA:3,0",
  "DA:4,0",
  "LF:4",
  "LH:2",
  "BRF:2",
  "BRH:1",
  "end_of_record",
  "SF:src/b.ts",
  "FNF:1",
  "FNH:1",
  "LF:10",
  "LH:10",
  "BRF:0",
  "BRH:0",
  "end_of_record",
  ""
].join("\n");

test("parseLcov returns per-file coverage percentages and aggregate totals", () => {
  const report = parseLcov(sampleLcov);

  assert.equal(report.files.length, 2);
  const fileA = report.files.find((file) => file.path === "src/a.ts");
  assert.equal(fileA.lineCoverage, 50, "50% of 4 lines hit");
  assert.equal(fileA.branchCoverage, 50);
  assert.equal(fileA.functionCoverage, 50);

  const fileB = report.files.find((file) => file.path === "src/b.ts");
  assert.equal(fileB.lineCoverage, 100);
  assert.equal(fileB.branchCoverage, null, "0 branches should yield null, not divide-by-zero");

  assert.equal(report.totals.linesFound, 14);
  assert.equal(report.totals.linesHit, 12);
  assert.equal(report.totals.lineCoverage, Math.round((12 / 14) * 10000) / 100);
});

test("parseLcov ignores malformed lines and rejects non-string input", () => {
  const report = parseLcov("noise without tags\nSF:x\nLF:5\nLH:3\nend_of_record\n");
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].lineCoverage, 60);

  assert.throws(() => parseLcov(null), /string LCOV source/);
});

test("applyCoverageToGraph matches exact, suffix, and basename-only paths", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/a.ts", type: "file", path: "src/a.ts", label: "a.ts" },
      { id: "file:src/c.ts", type: "file", path: "src/c.ts", label: "c.ts" },
      { id: "file:src/uncovered.ts", type: "file", path: "src/uncovered.ts", label: "uncovered.ts" }
    ],
    edges: []
  };
  const coverage = parseLcov([
    "SF:./src/a.ts",
    "LF:4", "LH:2",
    "end_of_record",
    "SF:tests/c.ts",
    "LF:5", "LH:5",
    "end_of_record",
    ""
  ].join("\n"));

  const { graph: enriched, matchReport } = applyCoverageToGraph(graph, coverage);

  const fileA = enriched.nodes.find((node) => node.id === "file:src/a.ts");
  const fileC = enriched.nodes.find((node) => node.id === "file:src/c.ts");
  const fileUncovered = enriched.nodes.find((node) => node.id === "file:src/uncovered.ts");

  assert.equal(fileA.coverage.lineCoverage, 50, "leading-dot prefix should match exactly after normalize");
  assert.equal(fileC.coverage.lineCoverage, 100, "tests/c.ts vs src/c.ts should fall through to basename match");
  assert.equal(fileC.coverage.weakMatch, true, "basename-only match should be marked weak");
  assert.equal(fileUncovered.coverage, null);
  assert.equal(matchReport.matched, 2);
  assert.equal(matchReport.unmatchedGraph, 1);
});

test("applyCoverageToGraph honors allowBasenameMatch=false", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [{ id: "file:src/c.ts", type: "file", path: "src/c.ts", label: "c.ts" }],
    edges: []
  };
  const coverage = parseLcov(["SF:tests/c.ts", "LF:5", "LH:5", "end_of_record", ""].join("\n"));

  const { graph: enriched, matchReport } = applyCoverageToGraph(graph, coverage, { allowBasenameMatch: false });

  assert.equal(enriched.nodes[0].coverage, null);
  assert.equal(matchReport.matched, 0);
});

test("rankByCoverageRisk surfaces high-risk low-coverage files and respects threshold", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/hot.ts", type: "file", path: "src/hot.ts", label: "hot.ts" },
      { id: "file:src/cold.ts", type: "file", path: "src/cold.ts", label: "cold.ts" },
      { id: "file:src/dep.ts", type: "file", path: "src/dep.ts", label: "dep.ts" },
      { id: "package:react", type: "package", label: "react" }
    ],
    edges: [
      { id: "i1", type: "imports", from: "file:src/hot.ts", to: "file:src/dep.ts", scope: "internal" },
      { id: "i2", type: "imports", from: "file:src/cold.ts", to: "file:src/dep.ts", scope: "internal" },
      { id: "d1", type: "dependency", from: "file:src/hot.ts", to: "package:react", scope: "external" }
    ]
  };
  const coverage = parseLcov([
    "SF:src/hot.ts", "LF:10", "LH:2", "end_of_record",
    "SF:src/cold.ts", "LF:10", "LH:9", "end_of_record",
    "SF:src/dep.ts", "LF:10", "LH:0", "end_of_record",
    ""
  ].join("\n"));

  const ranking = rankByCoverageRisk(graph, coverage, { coverageThreshold: 80, limit: 10 });

  assert.ok(ranking.rows.length > 0);
  assert.ok(!ranking.rows.some((row) => row.path === "src/cold.ts"), "90%-covered file should be filtered above threshold");
  const top = ranking.rows[0];
  assert.equal(top.path, "src/dep.ts", "dep.ts has highest fan-in and 0% coverage");
  assert.ok(top.priority > 0);
});

test("applyCoverageToGraph rejects ambiguous basename matches by leaving the file unmatched", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [{ id: "file:src/index.ts", type: "file", path: "src/index.ts", label: "index.ts" }],
    edges: []
  };
  const coverage = parseLcov([
    "SF:packages/a/index.ts", "LF:5", "LH:5", "end_of_record",
    "SF:packages/b/index.ts", "LF:5", "LH:0", "end_of_record",
    ""
  ].join("\n"));

  const { graph: enriched, matchReport } = applyCoverageToGraph(graph, coverage);

  assert.equal(enriched.nodes[0].coverage, null, "two same-basename candidates should not collapse to either one");
  assert.equal(matchReport.matched, 0);
});

test("rankByCoverageRisk elevates graph files that have no LCOV entry alongside true 0%-coverage files", () => {
  const graph = {
    version: 1,
    generatedAt: "t",
    root: "t",
    nodes: [
      { id: "file:src/hot.ts", type: "file", path: "src/hot.ts", label: "hot.ts" },
      { id: "file:src/missing.ts", type: "file", path: "src/missing.ts", label: "missing.ts" },
      { id: "file:src/dep.ts", type: "file", path: "src/dep.ts", label: "dep.ts" }
    ],
    edges: [
      { id: "i1", type: "imports", from: "file:src/hot.ts", to: "file:src/dep.ts", scope: "internal" },
      { id: "i2", type: "imports", from: "file:src/missing.ts", to: "file:src/dep.ts", scope: "internal" }
    ]
  };
  // Only hot.ts has LCOV data (0% covered); missing.ts has no LCOV entry at all.
  const coverage = parseLcov(["SF:src/hot.ts", "LF:10", "LH:0", "end_of_record", ""].join("\n"));

  const ranking = rankByCoverageRisk(graph, coverage, { coverageThreshold: 80, limit: 10 });

  const missingRow = ranking.rows.find((row) => row.path === "src/missing.ts");
  assert.ok(missingRow, "graph files with no LCOV entry should appear in the ranking, not silently disappear");
  assert.equal(missingRow.hasCoverage, false);
  assert.equal(missingRow.lineCoverage, null);
  assert.ok(missingRow.priority > 0, "files with no coverage and positive risk should get a positive priority");
});

test("loadLcov reads disk content and propagates parse output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "repograph-lcov-"));
  const lcovPath = path.join(dir, "coverage.info");
  await writeFile(lcovPath, sampleLcov, "utf8");

  const report = await loadLcov(lcovPath);
  assert.equal(report.files.length, 2);

  await rm(dir, { recursive: true, force: true });
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

function buildSelectionGraph() {
  return {
    version: 1,
    generatedAt: "fixture",
    root: "fixture",
    nodes: [
      { id: "file:src/auth.ts", type: "file", path: "src/auth.ts", label: "auth.ts" },
      { id: "file:src/db.ts", type: "file", path: "src/db.ts", label: "db.ts" },
      { id: "file:src/util.ts", type: "file", path: "src/util.ts", label: "util.ts" },
      { id: "file:test/auth.test.ts", type: "file", path: "test/auth.test.ts", label: "auth.test.ts" },
      { id: "file:test/db.test.ts", type: "file", path: "test/db.test.ts", label: "db.test.ts" },
      { id: "file:tests/integration.spec.ts", type: "file", path: "tests/integration.spec.ts", label: "integration.spec.ts" },
      { id: "file:src/lonely.ts", type: "file", path: "src/lonely.ts", label: "lonely.ts" }
    ],
    edges: [
      { id: "e1", type: "imports", from: "file:src/auth.ts", to: "file:src/db.ts", scope: "internal" },
      { id: "e2", type: "imports", from: "file:test/auth.test.ts", to: "file:src/auth.ts", scope: "internal" },
      { id: "e3", type: "imports", from: "file:test/db.test.ts", to: "file:src/db.ts", scope: "internal" },
      { id: "e4", type: "imports", from: "file:tests/integration.spec.ts", to: "file:src/auth.ts", scope: "internal" },
      { id: "e5", type: "imports", from: "file:src/util.ts", to: "file:src/db.ts", scope: "internal" }
    ]
  };
}

test("selectTests returns the minimum test set for a diff via reverse-import walk", () => {
  const graph = buildSelectionGraph();
  const report = selectTests(graph, ["src/db.ts"]);

  assert.deepEqual(report.tests, ["test/auth.test.ts", "test/db.test.ts", "tests/integration.spec.ts"]);
  assert.equal(report.summary.tests, 3);
  assert.equal(report.summary.changed, 1);
  assert.ok(report.summary.affected >= 3);
});

test("selectTests treats a changed test file as one of its own selected tests", () => {
  const graph = buildSelectionGraph();
  const report = selectTests(graph, ["test/auth.test.ts"]);

  assert.ok(report.tests.includes("test/auth.test.ts"), "the changed test file should appear in the selection");
});

test("selectTests respects custom testPatterns and skips files that no longer match", () => {
  const graph = buildSelectionGraph();
  // Restrict the test pattern to `tests/**` only — the `test/**` directory
  // should drop out of the selection entirely.
  const report = selectTests(graph, ["src/db.ts"], { testPatterns: ["tests/**"] });

  assert.deepEqual(report.tests, ["tests/integration.spec.ts"]);
});

test("selectTests honors maxDepth so only direct callers are included when depth=1", () => {
  const graph = buildSelectionGraph();
  const report = selectTests(graph, ["src/db.ts"], { maxDepth: 1 });

  // src/db.ts -> direct importers: src/auth.ts, test/db.test.ts, src/util.ts
  // test/db.test.ts is a direct test importer of db.ts so it must appear.
  assert.ok(report.tests.includes("test/db.test.ts"));
  // test/auth.test.ts only imports auth.ts (depth 2 from db.ts), should be filtered when depth=1.
  assert.ok(!report.tests.includes("test/auth.test.ts"), "depth=1 should exclude test/auth.test.ts (it imports auth, which imports db)");
});

test("selectTests returns an empty test array when changed files have no test consumers", () => {
  const graph = buildSelectionGraph();
  const report = selectTests(graph, ["src/lonely.ts"]);

  assert.equal(report.tests.length, 0);
  assert.equal(report.summary.tests, 0);
  assert.ok(report.summary.coverageRatio !== null, "coverageRatio should be a number when test files exist in the graph");
});

test("selectTests throws on malformed input", () => {
  const graph = buildSelectionGraph();
  assert.throws(() => selectTests(null, ["x"]), /requires a graph/);
  assert.throws(() => selectTests(graph, "not-an-array"), /changedFiles to be an array/);
});

function buildDriftGraph(spec) {
  const fileNodes = spec.files.map((path) => ({ id: `file:${path}`, type: "file", path, label: path.split("/").pop() }));
  const packageNodes = (spec.packages ?? []).map((name) => ({ id: `package:${name}`, type: "package", label: name }));
  const edges = (spec.edges ?? []).map((edge, index) => ({
    id: `e${index}`,
    type: edge.type ?? "imports",
    from: edge.from,
    to: edge.to,
    scope: edge.scope ?? "internal"
  }));
  return { version: 1, generatedAt: "fixture", root: "fixture", nodes: [...fileNodes, ...packageNodes], edges };
}

test("detectDrift accepts both raw graphs and snapshots and reports a passing diff", () => {
  const base = buildDriftGraph({
    files: ["src/a.ts", "src/b.ts"],
    edges: [{ from: "file:src/a.ts", to: "file:src/b.ts" }]
  });
  const head = buildDriftGraph({
    files: ["src/a.ts", "src/b.ts"],
    edges: [{ from: "file:src/a.ts", to: "file:src/b.ts" }]
  });

  const report = detectDrift(createGraphSnapshot(base), head);
  assert.equal(report.passed, true);
  assert.equal(report.summary.failedChecks.length, 0);
  assert.equal(report.checks.find((check) => check.name === "newCycles").delta, 0);
});

test("detectDrift fails when a new cycle appears, even with the default zero-tolerance threshold", () => {
  const base = buildDriftGraph({
    files: ["src/a.ts", "src/b.ts"],
    edges: [{ from: "file:src/a.ts", to: "file:src/b.ts" }]
  });
  const head = buildDriftGraph({
    files: ["src/a.ts", "src/b.ts"],
    edges: [
      { from: "file:src/a.ts", to: "file:src/b.ts" },
      { from: "file:src/b.ts", to: "file:src/a.ts" }
    ]
  });

  const report = detectDrift(base, head);
  assert.equal(report.passed, false);
  assert.ok(report.summary.failedChecks.includes("newCycles"));
});

test("detectDrift treats reductions as non-violations even with a zero threshold", () => {
  const base = buildDriftGraph({
    files: ["src/a.ts", "src/b.ts", "src/c.ts"],
    edges: [
      { from: "file:src/a.ts", to: "file:src/b.ts" },
      { from: "file:src/b.ts", to: "file:src/c.ts" }
    ]
  });
  const head = buildDriftGraph({
    files: ["src/a.ts"],
    edges: []
  });

  const report = detectDrift(base, head, { thresholds: { maxRemovedFiles: 5, maxInternalDepIncrease: 0 } });
  assert.equal(report.checks.find((check) => check.name === "internalDepIncrease").passed, true,
    "reducing internal dependencies should never fail a max-increase check");
});

test("detectDrift trips the threshold when an external dependency is added beyond the cap", () => {
  const base = buildDriftGraph({
    files: ["src/a.ts"],
    packages: [],
    edges: []
  });
  const head = buildDriftGraph({
    files: ["src/a.ts"],
    packages: ["lodash"],
    edges: [{ from: "file:src/a.ts", to: "package:lodash", type: "dependency", scope: "external" }]
  });

  const report = detectDrift(base, head, { thresholds: { maxNewExternalPackages: 0 } });
  const newPackagesCheck = report.checks.find((check) => check.name === "newExternalPackages");
  assert.equal(newPackagesCheck.delta, 1);
  assert.equal(newPackagesCheck.passed, false);
  assert.equal(report.passed, false);
});

test("detectDrift throws when either input is not a graph or snapshot", () => {
  const good = buildDriftGraph({ files: ["src/a.ts"], edges: [] });
  assert.throws(() => detectDrift(null, good), /base/);
  assert.throws(() => detectDrift(good, "not-a-graph"), /head/);
  assert.throws(() => detectDrift({ nodes: [] }, good), /not a recognised graph or snapshot/);
});
