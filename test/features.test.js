import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  analyzeRepository,
  analyzeSupplyChain,
  parseCargoDependencies,
  parsePyprojectDependencies,
  parseRequirements,
  toMermaid
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
