import { compareGraphSnapshots, createGraphSnapshot } from "./operations.js";

const DEFAULT_THRESHOLDS = {
  maxNewCycles: 0,
  maxRemovedFiles: Infinity,
  maxAddedFiles: Infinity,
  maxInternalDepIncrease: Infinity,
  maxExternalDepIncrease: Infinity,
  maxDensityIncrease: Infinity,
  maxNewExternalPackages: Infinity
};

/**
 * Detect structural drift between a baseline and a current state.
 *
 * Wraps `compareGraphSnapshots` with a threshold matrix so CI can gate
 * merges on bounded structural metrics. The default threshold is "no
 * new cycles allowed"; every other metric is uncapped by default so a
 * project can opt in to additional checks one at a time.
 *
 * @param {object} baseInput  - A graph or a graph snapshot.
 * @param {object} headInput  - A graph or a graph snapshot.
 * @param {object} [options]
 * @param {object} [options.thresholds] - Per-metric drift caps.
 * @returns {object}
 */
export function detectDrift(baseInput, headInput, options = {}) {
  const baseSnapshot = ensureSnapshot(baseInput, "base");
  const headSnapshot = ensureSnapshot(headInput, "head");
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };

  const comparison = compareGraphSnapshots(baseSnapshot, headSnapshot);
  const newPackageCount = (headSnapshot.packages ?? []).filter(
    (name) => !(baseSnapshot.packages ?? []).includes(name)
  ).length;

  const checks = [
    {
      name: "newCycles",
      baseline: (baseSnapshot.circularDependencies ?? []).length,
      current: (headSnapshot.circularDependencies ?? []).length,
      delta: comparison.cycles.new.length,
      threshold: thresholds.maxNewCycles
    },
    {
      name: "addedFiles",
      baseline: (baseSnapshot.files ?? []).length,
      current: (headSnapshot.files ?? []).length,
      delta: comparison.files.added.length,
      threshold: thresholds.maxAddedFiles
    },
    {
      name: "removedFiles",
      baseline: (baseSnapshot.files ?? []).length,
      current: (headSnapshot.files ?? []).length,
      delta: comparison.files.removed.length,
      threshold: thresholds.maxRemovedFiles
    },
    {
      name: "internalDepIncrease",
      baseline: baseSnapshot.metrics?.internalDependencies ?? 0,
      current: headSnapshot.metrics?.internalDependencies ?? 0,
      delta: comparison.dependencies.internalDelta,
      threshold: thresholds.maxInternalDepIncrease
    },
    {
      name: "externalDepIncrease",
      baseline: baseSnapshot.metrics?.externalDependencies ?? 0,
      current: headSnapshot.metrics?.externalDependencies ?? 0,
      delta: comparison.dependencies.externalDelta,
      threshold: thresholds.maxExternalDepIncrease
    },
    {
      name: "densityIncrease",
      baseline: baseSnapshot.metrics?.dependencyDensity ?? 0,
      current: headSnapshot.metrics?.dependencyDensity ?? 0,
      delta: comparison.dependencies.densityDelta,
      threshold: thresholds.maxDensityIncrease
    },
    {
      name: "newExternalPackages",
      baseline: (baseSnapshot.packages ?? []).length,
      current: (headSnapshot.packages ?? []).length,
      delta: newPackageCount,
      threshold: thresholds.maxNewExternalPackages
    }
  ].map((check) => {
    // A delta that is at or below the threshold passes. We coerce
    // negative deltas (improvements) to 0 because a project should
    // never "fail" for reducing complexity even if the threshold is 0.
    const effectiveDelta = check.delta > 0 ? check.delta : 0;
    return { ...check, effectiveDelta, passed: effectiveDelta <= check.threshold };
  });

  const failedChecks = checks.filter((check) => !check.passed);
  const passed = failedChecks.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    base: {
      root: baseSnapshot.root,
      fingerprint: baseSnapshot.fingerprint,
      generatedAt: baseSnapshot.generatedAt
    },
    head: {
      root: headSnapshot.root,
      fingerprint: headSnapshot.fingerprint,
      generatedAt: headSnapshot.generatedAt
    },
    thresholds,
    checks,
    passed,
    summary: {
      passed,
      failedChecks: failedChecks.map((check) => check.name),
      severity: comparison.severity,
      fingerprintChanged: comparison.changed
    },
    comparison
  };
}

function ensureSnapshot(input, label) {
  if (!input || typeof input !== "object") {
    throw new Error(`detectDrift requires a ${label} graph or snapshot.`);
  }
  // Snapshots are detected by a combination of marker fields rather
  // than the `schema` string alone — a malicious graph that sets the
  // schema field would otherwise bypass the inline-snapshot path. The
  // marker set is what `createGraphSnapshot` always emits.
  const looksLikeSnapshot = input.schema === "repograph.snapshot.v1"
    && typeof input.fingerprint === "string"
    && Array.isArray(input.files);
  if (looksLikeSnapshot) {
    return input;
  }
  if (Array.isArray(input.nodes) && Array.isArray(input.edges)) {
    return createGraphSnapshot(input);
  }
  throw new Error(`detectDrift ${label} input is not a recognised graph or snapshot.`);
}

export { DEFAULT_THRESHOLDS };
