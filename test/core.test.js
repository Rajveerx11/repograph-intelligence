import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { analyzeRepository, calculateMetrics } from "../packages/core/src/index.js";

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
