import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  analyzeImpact,
  analyzePullRequest,
  analyzeRepositories,
  analyzeRepository,
  calculateMetrics,
  compressContext,
  createAgentContext,
  createGuidanceReport,
  semanticSearch,
  simulateRefactor,
  scoreDependencyRisk,
  summarizeRepository
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
