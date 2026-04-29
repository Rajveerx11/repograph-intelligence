import { createHash } from "node:crypto";
import { analyzeSecurityRisk } from "./security.js";
import { calculateMetrics } from "./metrics.js";
import { recommendArchitecture } from "./recommendations.js";

export function validateGraph(graph) {
  const errors = [];
  const warnings = [];

  if (!graph || typeof graph !== "object") {
    return {
      valid: false,
      errors: ["Graph must be an object."],
      warnings: [],
      summary: "Graph is invalid."
    };
  }

  if (!graph.version) {
    errors.push("Graph version is required.");
  }
  if (!Array.isArray(graph.nodes)) {
    errors.push("Graph nodes must be an array.");
  }
  if (!Array.isArray(graph.edges)) {
    errors.push("Graph edges must be an array.");
  }

  if (errors.length) {
    return {
      valid: false,
      errors,
      warnings,
      summary: `${errors.length} graph validation error(s).`
    };
  }

  const nodeIds = new Set();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push("Every node must have an id.");
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!node.type) {
      errors.push(`Node ${node.id} is missing type.`);
    }
    if (node.type === "file" && !node.path) {
      errors.push(`File node ${node.id} is missing path.`);
    }
  }

  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (!edge.id) {
      errors.push("Every edge must have an id.");
      continue;
    }
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    if (!edge.type) {
      errors.push(`Edge ${edge.id} is missing type.`);
    }
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge ${edge.id} references missing source node ${edge.from}.`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge ${edge.id} references missing target node ${edge.to}.`);
    }
    if ((edge.type === "imports" || edge.type === "dependency") && !edge.scope) {
      warnings.push(`Edge ${edge.id} is missing dependency scope.`);
    }
  }

  const filePaths = graph.nodes.filter((node) => node.type === "file").map((node) => node.path);
  const duplicatePaths = duplicates(filePaths);
  for (const filePath of duplicatePaths) {
    errors.push(`Duplicate file path: ${filePath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: errors.length
      ? `${errors.length} graph validation error(s), ${warnings.length} warning(s).`
      : `Graph is valid with ${warnings.length} warning(s).`
  };
}

export function createGraphSnapshot(graph) {
  const validation = validateGraph(graph);
  const metrics = validation.valid ? calculateMetrics(graph) : null;
  const fileProfiles = validation.valid ? profileFiles(graph) : [];
  const packages = graph.nodes
    .filter((node) => node.type === "package")
    .map((node) => node.label)
    .sort();

  return {
    version: 1,
    schema: "repograph.snapshot.v1",
    generatedAt: new Date().toISOString(),
    root: graph.root,
    graphVersion: graph.version,
    validation,
    fingerprint: fingerprint({
      files: fileProfiles,
      packages,
      metrics
    }),
    metrics,
    files: fileProfiles,
    packages,
    circularDependencies: metrics?.circularDependencies ?? []
  };
}

export function compareGraphSnapshots(baseSnapshot, headSnapshot) {
  const baseFiles = new Map((baseSnapshot.files ?? []).map((file) => [file.path, file]));
  const headFiles = new Map((headSnapshot.files ?? []).map((file) => [file.path, file]));
  const addedFiles = [...headFiles.keys()].filter((filePath) => !baseFiles.has(filePath)).sort();
  const removedFiles = [...baseFiles.keys()].filter((filePath) => !headFiles.has(filePath)).sort();
  const changedFiles = [...headFiles.keys()]
    .filter((filePath) => baseFiles.has(filePath) && baseFiles.get(filePath).fingerprint !== headFiles.get(filePath).fingerprint)
    .sort();
  const baseCycles = new Set(baseSnapshot.circularDependencies ?? []);
  const headCycles = new Set(headSnapshot.circularDependencies ?? []);
  const newCycles = [...headCycles].filter((cycle) => !baseCycles.has(cycle)).sort();
  const resolvedCycles = [...baseCycles].filter((cycle) => !headCycles.has(cycle)).sort();
  const metricDelta = compareMetrics(baseSnapshot.metrics, headSnapshot.metrics);

  const severity = comparisonSeverity({ addedFiles, removedFiles, changedFiles, newCycles, metricDelta });

  return {
    generatedAt: new Date().toISOString(),
    base: {
      root: baseSnapshot.root,
      fingerprint: baseSnapshot.fingerprint
    },
    head: {
      root: headSnapshot.root,
      fingerprint: headSnapshot.fingerprint
    },
    changed: baseSnapshot.fingerprint !== headSnapshot.fingerprint,
    severity,
    summary: summarizeComparison({ addedFiles, removedFiles, changedFiles, newCycles, resolvedCycles, metricDelta }),
    files: {
      added: addedFiles,
      removed: removedFiles,
      changed: changedFiles
    },
    dependencies: {
      internalDelta: metricDelta.internalDependencies ?? 0,
      externalDelta: metricDelta.externalDependencies ?? 0,
      densityDelta: metricDelta.dependencyDensity ?? 0
    },
    cycles: {
      new: newCycles,
      resolved: resolvedCycles
    },
    metrics: {
      base: baseSnapshot.metrics,
      head: headSnapshot.metrics,
      delta: metricDelta
    }
  };
}

export function createCiReport(graph, options = {}) {
  const validation = validateGraph(graph);
  const snapshot = createGraphSnapshot(graph);
  const baselineComparison = options.baseline ? compareGraphSnapshots(options.baseline, snapshot) : null;
  const security = validation.valid ? analyzeSecurityRisk(graph) : { findings: [] };
  const recommendations = validation.valid ? recommendArchitecture(graph) : { recommendations: [] };
  const findings = [
    ...validationFindings(validation),
    ...securityFindings(security),
    ...recommendationFindings(recommendations),
    ...comparisonFindings(baselineComparison)
  ];
  const failOn = options.failOn ?? "high";
  const status = findings.some((finding) => severityRank(finding.severity) >= severityRank(failOn))
    ? "fail"
    : "pass";

  return {
    generatedAt: new Date().toISOString(),
    status,
    failOn,
    summary: summarizeCi(status, findings, baselineComparison),
    validation,
    baselineComparison,
    findings,
    snapshot
  };
}

function profileFiles(graph) {
  const internalEdges = graph.edges.filter((edge) => edge.scope === "internal");
  const externalEdges = graph.edges.filter((edge) => edge.scope === "external");

  return graph.nodes
    .filter((node) => node.type === "file")
    .map((node) => {
      const incoming = internalEdges.filter((edge) => edge.to === node.id).length;
      const outgoing = internalEdges.filter((edge) => edge.from === node.id).length;
      const external = externalEdges.filter((edge) => edge.from === node.id).length;
      const profile = {
        path: node.path,
        language: node.language,
        lineCount: node.lineCount ?? 0,
        symbolCount: node.symbolCount ?? 0,
        incoming,
        outgoing,
        externalDependencies: external
      };
      return {
        ...profile,
        fingerprint: fingerprint(profile)
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function compareMetrics(baseMetrics = {}, headMetrics = {}) {
  const keys = [
    "files",
    "symbols",
    "edges",
    "internalDependencies",
    "externalDependencies",
    "dependencyDensity"
  ];
  const delta = {};
  for (const key of keys) {
    const base = Number(baseMetrics?.[key] ?? 0);
    const head = Number(headMetrics?.[key] ?? 0);
    delta[key] = Number((head - base).toFixed(4));
  }
  return delta;
}

function validationFindings(validation) {
  return [
    ...validation.errors.map((message) => ({
      severity: "high",
      type: "graph_validation_error",
      message
    })),
    ...validation.warnings.map((message) => ({
      severity: "low",
      type: "graph_validation_warning",
      message
    }))
  ];
}

function securityFindings(security) {
  return (security.findings ?? [])
    .filter((finding) => finding.severity === "high")
    .map((finding) => ({
      severity: "high",
      type: "security_architecture_risk",
      target: finding.target,
      message: finding.message
    }));
}

function recommendationFindings(recommendations) {
  return (recommendations.recommendations ?? [])
    .filter((recommendation) => recommendation.priority === "high")
    .slice(0, 10)
    .map((recommendation) => ({
      severity: "medium",
      type: recommendation.type,
      target: recommendation.target,
      message: recommendation.reason
    }));
}

function comparisonFindings(comparison) {
  if (!comparison) {
    return [];
  }

  const findings = [];
  for (const cycle of comparison.cycles.new) {
    findings.push({
      severity: "high",
      type: "new_circular_dependency",
      target: cycle,
      message: "A new circular dependency was introduced relative to the baseline."
    });
  }
  if (comparison.dependencies.internalDelta >= 5) {
    findings.push({
      severity: "medium",
      type: "dependency_growth",
      message: `Internal dependency count increased by ${comparison.dependencies.internalDelta}.`
    });
  }
  if (comparison.files.added.length + comparison.files.changed.length >= 20) {
    findings.push({
      severity: "medium",
      type: "large_structural_change",
      message: "This change modifies a large number of graph file profiles."
    });
  }
  return findings;
}

function comparisonSeverity({ newCycles, removedFiles, metricDelta }) {
  if (newCycles.length) {
    return "high";
  }
  if (removedFiles.length || (metricDelta.internalDependencies ?? 0) >= 5) {
    return "medium";
  }
  return "low";
}

function summarizeComparison({ addedFiles, removedFiles, changedFiles, newCycles, resolvedCycles, metricDelta }) {
  return [
    `${addedFiles.length} added, ${removedFiles.length} removed, and ${changedFiles.length} changed file profile(s).`,
    `${newCycles.length} new and ${resolvedCycles.length} resolved cycle(s).`,
    `Internal dependency delta: ${metricDelta.internalDependencies ?? 0}.`
  ].join(" ");
}

function summarizeCi(status, findings, comparison) {
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const comparisonText = comparison ? ` Baseline comparison: ${comparison.summary}` : "";
  return `CI status: ${status}. ${high} high and ${medium} medium finding(s).${comparisonText}`;
}

function duplicates(items) {
  const seen = new Set();
  const duplicateItems = new Set();
  for (const item of items) {
    if (seen.has(item)) {
      duplicateItems.add(item);
    }
    seen.add(item);
  }
  return Array.from(duplicateItems).sort();
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function severityRank(severity) {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  if (severity === "low") {
    return 1;
  }
  return 3;
}
