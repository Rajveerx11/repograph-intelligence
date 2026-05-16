import { analyzeImpact } from "./impact.js";
import { compileGlob } from "./policy.js";

const DEFAULT_TEST_PATTERNS = [
  "test/**",
  "tests/**",
  "**/__tests__/**",
  "**/*.test.js",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.jsx",
  "**/*.test.mjs",
  "**/*.test.cjs",
  "**/*.test.py",
  "**/*.spec.js",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.jsx",
  "**/*.spec.mjs",
  "**/*.spec.cjs",
  "**/*.spec.py",
  "**/*_test.go",
  "**/*_test.py"
];

/**
 * Select the minimum set of tests that exercise a set of changed files.
 *
 * Walks the graph in reverse (callers → callees) from each changed file,
 * collects every file that transitively depends on a changed file, and
 * filters that set to test files via configurable glob patterns. The
 * output is the list a CI step should run after a diff lands; running
 * the full test suite becomes a sanity-check rather than the default.
 *
 * @param {object} graph
 * @param {Array<string>} changedFiles
 * @param {object} [options]
 * @param {Array<string>} [options.testPatterns] - Override the default
 *        pattern list. Globs accept `**`, `*`, `?`.
 * @param {number}  [options.maxDepth=Infinity] - Cap reverse-walk depth.
 * @param {boolean} [options.includeChangedTests=true] - Also include
 *        changed files that themselves match a test pattern.
 * @returns {object}
 */
export function selectTests(graph, changedFiles, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("selectTests requires a graph with nodes and edges arrays.");
  }
  if (!Array.isArray(changedFiles)) {
    throw new Error("selectTests requires changedFiles to be an array.");
  }

  const patterns = Array.isArray(options.testPatterns) && options.testPatterns.length
    ? options.testPatterns
    : DEFAULT_TEST_PATTERNS;
  const matchers = patterns.map((pattern) => compileGlob(pattern));
  const isTestPath = (filePath) => matchers.some((match) => match(filePath));
  const includeChangedTests = options.includeChangedTests !== false;
  const maxDepth = options.maxDepth ?? Infinity;

  const impact = analyzeImpact(graph, changedFiles, { maxDepth });
  const affectedSet = new Set(impact.affectedFiles);
  // analyzeImpact returns *dependents* — files that consume the changed
  // surface. The changed files themselves are listed under
  // `impact.changedFiles` and need to be included here so a test file
  // edited directly counts as one of its own selected tests.
  for (const changedPath of impact.changedFiles) {
    affectedSet.add(changedPath);
  }

  const tests = [];
  const seenTests = new Set();
  for (const filePath of affectedSet) {
    if (!isTestPath(filePath)) {
      continue;
    }
    if (!includeChangedTests && impact.changedFiles.includes(filePath)) {
      continue;
    }
    if (seenTests.has(filePath)) {
      continue;
    }
    seenTests.add(filePath);
    tests.push(filePath);
  }
  tests.sort();

  const allKnownFiles = graph.nodes.filter((node) => node.type === "file").length;
  const allTestFiles = graph.nodes
    .filter((node) => node.type === "file" && typeof node.path === "string" && isTestPath(node.path))
    .map((node) => node.path);

  return {
    generatedAt: new Date().toISOString(),
    changedFiles: impact.changedFiles,
    affectedFiles: impact.affectedFiles,
    tests,
    summary: {
      changed: impact.changedFiles.length,
      affected: affectedSet.size,
      tests: tests.length,
      totalTestFiles: allTestFiles.length,
      totalFiles: allKnownFiles,
      coverageRatio: allTestFiles.length === 0 ? null : Math.round((tests.length / allTestFiles.length) * 10000) / 100,
      blastRadius: impact.blastRadius,
      risk: impact.risk
    }
  };
}

export { DEFAULT_TEST_PATTERNS };
