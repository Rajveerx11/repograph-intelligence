import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeImpact,
  analyzePullRequest,
  analyzeRepositories,
  analyzeRepository,
  analyzeSecurityRisk,
  calculateMetrics,
  compareGraphSnapshots,
  compressContext,
  createCiReport,
  createAgentContext,
  createGuidanceReport,
  createGraphSnapshot,
  inferOwnership,
  recommendArchitecture,
  semanticSearch,
  simulateRefactor,
  scoreDependencyRisk,
  summarizeEvolution,
  summarizeRepository,
  validateGraph
} from "../packages/core/src/index.js";

const fixturePath = path.resolve("test/fixtures/sample-repo");

test("analyzes files, symbols, internal imports, and external dependencies", async () => {
  const graph = await analyzeRepository(fixturePath);
  const metrics = calculateMetrics(graph);

  assert.equal(metrics.files, 4);
  assert.equal(metrics.internalDependencies, 2);
  assert.equal(metrics.externalDependencies, 2);
  assert.equal(metrics.symbols, 5);

  assert.ok(graph.nodes.some((node) => node.id === "file:src/index.ts"));
  assert.ok(graph.nodes.some((node) => node.id === "symbol:src/index.ts:main"));
  assert.ok(graph.edges.some((edge) => edge.from === "file:src/index.ts" && edge.to === "file:src/util.ts"));
  assert.ok(graph.edges.some((edge) => edge.to === "package:express"));
});

test("reports orphan files and hotspots", async () => {
  const graph = await analyzeRepository(fixturePath);
  const metrics = calculateMetrics(graph);

  assert.deepEqual(metrics.orphanFiles, []);
  assert.ok(metrics.hotspots.some((item) => item.path === "py/helpers.py"));
});

test("searches files by semantic relevance", async () => {
  const graph = await analyzeRepository(fixturePath);
  const results = semanticSearch(graph, "greeting application flow", { limit: 2 });

  assert.equal(results[0].path, "src/index.ts");
  assert.ok(results.some((result) => result.path === "src/util.ts"));
  assert.ok(results[0].score > 0);
});

test("summarizes architecture and compresses context", async () => {
  const graph = await analyzeRepository(fixturePath);
  const summary = summarizeRepository(graph);
  const context = compressContext(graph);

  assert.equal(summary.metrics.files, 4);
  assert.ok(summary.architecture.modules.some((module) => module.name === "src"));
  assert.match(summary.overview, /Detected/);
  assert.match(context, /# RepoGraph Context/);
  assert.match(context, /## Modules/);
});

test("analyzes blast radius for changed files", async () => {
  const graph = await analyzeRepository(fixturePath);
  const impact = analyzeImpact(graph, ["src/util.ts"]);

  assert.deepEqual(impact.changedFiles, ["src/util.ts"]);
  assert.deepEqual(impact.directDependents, ["src/index.ts"]);
  assert.equal(impact.blastRadius, 1);
  assert.equal(impact.risk.level, "low");
  assert.equal(impact.risk.score, 30);
});

test("scores dependency risk by fan-in, fan-out, and external dependencies", async () => {
  const graph = await analyzeRepository(fixturePath);
  const risks = scoreDependencyRisk(graph);

  assert.equal(risks[0].path, "py/app.py");
  assert.ok(risks.some((risk) => risk.path === "src/util.ts" && risk.reasons.some((reason) => reason.includes("downstream"))));
});

test("simulates refactors and pull request impact", async () => {
  const graph = await analyzeRepository(fixturePath);
  const simulation = simulateRefactor(graph, ["py/helpers.py"]);
  const pullRequest = analyzePullRequest(graph, ["py/helpers.py"]);

  assert.deepEqual(simulation.impact.directDependents, ["py/app.py"]);
  assert.ok(simulation.recommendations.length > 0);
  assert.match(pullRequest.summary, /Blast radius: 1/);
  assert.equal(pullRequest.risk.level, "low");
});

test("creates AI agent context with search, impact, and guidance", async () => {
  const graph = await analyzeRepository(fixturePath);
  const context = createAgentContext(graph, {
    query: "greeting flow",
    changedFiles: ["src/util.ts"]
  });

  assert.equal(context.version, 1);
  assert.equal(context.impact.blastRadius, 1);
  assert.ok(context.semanticMatches.some((match) => match.path === "src/index.ts"));
  assert.ok(context.guidance.recommendations.length > 0);
  assert.match(context.compressedContext, /RepoGraph Context/);
});

test("generates structural guidance warnings", async () => {
  const graph = await analyzeRepository(fixturePath);
  const guidance = createGuidanceReport(graph, { changedFiles: ["src/util.ts"] });

  assert.ok(Array.isArray(guidance.warnings));
  assert.ok(guidance.recommendations.length > 0);
});

test("summarizes multiple repositories as a workspace", async () => {
  const workspace = await analyzeRepositories([fixturePath, fixturePath]);

  assert.equal(workspace.repositoryCount, 2);
  assert.equal(workspace.totals.files, 8);
  assert.ok(workspace.sharedExternalPackages.some((item) => item.name === "express"));
});

test("summarizes history and infers ownership", async () => {
  const graph = await analyzeRepository(fixturePath);
  const history = summarizeEvolution([
    {
      hash: "a",
      date: "2026-04-01",
      author: "Ada",
      subject: "update util",
      files: [{ path: "src/util.ts", additions: 80, deletions: 20 }]
    },
    {
      hash: "b",
      date: "2026-04-02",
      author: "Grace",
      subject: "update app",
      files: [{ path: "py/app.py", additions: 10, deletions: 5 }]
    }
  ]);
  const ownership = inferOwnership(graph, history);

  assert.equal(history.available, true);
  assert.equal(history.commitsAnalyzed, 2);
  assert.equal(history.fileHotspots[0].path, "src/util.ts");
  assert.equal(ownership.available, true);
  assert.equal(ownership.files.find((file) => file.path === "src/util.ts").primaryOwner, "Ada");
});

test("analyzes security surfaces and recommends architecture improvements", async () => {
  const graph = await analyzeRepository(fixturePath);
  const security = analyzeSecurityRisk(graph);
  const recommendations = recommendArchitecture(graph);

  assert.match(security.summary, /security architecture finding/);
  assert.ok(security.packageSurfaces.some((item) => item.name === "express"));
  assert.ok(Array.isArray(security.criticalBlastZones));
  assert.ok(recommendations.recommendations.length > 0);
  assert.ok(recommendations.signals.highRiskFiles >= 0);
});

test("validates graphs and creates comparable snapshots", async () => {
  const graph = await analyzeRepository(fixturePath);
  const validation = validateGraph(graph);
  const snapshot = createGraphSnapshot(graph);
  const modifiedSnapshot = {
    ...snapshot,
    fingerprint: "changed",
    files: snapshot.files.concat({
      path: "src/new.ts",
      language: "javascript",
      lineCount: 1,
      symbolCount: 0,
      incoming: 0,
      outgoing: 0,
      externalDependencies: 0,
      fingerprint: "new"
    }),
    metrics: {
      ...snapshot.metrics,
      files: snapshot.metrics.files + 1
    }
  };
  const comparison = compareGraphSnapshots(snapshot, modifiedSnapshot);

  assert.equal(validation.valid, true);
  assert.equal(snapshot.schema, "repograph.snapshot.v1");
  assert.equal(comparison.changed, true);
  assert.deepEqual(comparison.files.added, ["src/new.ts"]);
  assert.equal(comparison.metrics.delta.files, 1);
});

test("creates CI reports from graph intelligence and optional baselines", async () => {
  const graph = await analyzeRepository(fixturePath);
  const baseline = createGraphSnapshot(graph);
  const report = createCiReport(graph, { baseline, failOn: "high" });

  assert.equal(report.validation.valid, true);
  assert.equal(report.baselineComparison.changed, false);
  assert.match(report.summary, /CI status/);
  assert.ok(["pass", "fail"].includes(report.status));
});

test("bounds repository analysis to avoid oversized scans and files", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "repograph-security-"));
  await mkdir(path.join(repoPath, "src"));
  await writeFile(path.join(repoPath, "src", "small.ts"), "export function small() { return 1; }\n", "utf8");
  await writeFile(path.join(repoPath, "src", "large.ts"), `export const large = "${"x".repeat(2048)}";\n`, "utf8");

  const graph = await analyzeRepository(repoPath, { maxFileBytes: 1024 });

  assert.ok(graph.nodes.some((node) => node.id === "file:src/small.ts"));
  assert.ok(!graph.nodes.some((node) => node.id === "file:src/large.ts"));
  await assert.rejects(() => analyzeRepository(repoPath, { maxFiles: 1 }), /max file count/);
});

test("MCP server handles malformed input without dropping subsequent requests", async () => {
  const output = await runMcpProbe([
    "{bad json}\n",
    framedMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  ]);

  assert.match(output, /Invalid JSON message/);
  assert.match(output, /repograph_validate/);
});

function runMcpProbe(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["packages/mcp/src/server.js"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);

    for (const message of messages) {
      child.stdin.write(message);
    }

    setTimeout(() => {
      child.kill();
      if (stderr) {
        reject(new Error(stderr));
        return;
      }
      resolve(stdout);
    }, 300);
  });
}

function framedMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}
