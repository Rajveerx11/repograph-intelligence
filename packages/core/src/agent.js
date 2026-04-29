import { inferArchitecture } from "./architecture.js";
import { analyzeImpact, scoreDependencyRisk } from "./impact.js";
import { calculateMetrics } from "./metrics.js";
import { semanticSearch } from "./semantic.js";
import { compressContext, summarizeRepository } from "./summaries.js";

export function createAgentContext(graph, options = {}) {
  const query = options.query;
  const changedFiles = options.changedFiles ?? [];
  const summary = summarizeRepository(graph);
  const searchResults = query ? semanticSearch(graph, query, { limit: options.limit ?? 8 }) : [];
  const impact = changedFiles.length ? analyzeImpact(graph, changedFiles) : null;
  const guidance = createGuidanceReport(graph, { changedFiles });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: graph.root,
    summary: summary.overview,
    metrics: summary.metrics,
    architecture: summary.architecture,
    semanticMatches: searchResults,
    impact,
    guidance,
    compressedContext: compressContext(graph, {
      maxHotspots: options.maxHotspots ?? 8,
      maxModules: options.maxModules ?? 8
    })
  };
}

export function createContextApiResponse(graph, request = {}) {
  const context = createAgentContext(graph, request);
  return {
    ok: true,
    type: "repograph.context.v1",
    data: context
  };
}

export function createGuidanceReport(graph, options = {}) {
  const metrics = calculateMetrics(graph);
  const architecture = inferArchitecture(graph);
  const risks = scoreDependencyRisk(graph);
  const changedFiles = options.changedFiles ?? [];
  const impact = changedFiles.length ? analyzeImpact(graph, changedFiles) : null;
  const warnings = [];

  for (const item of risks.filter((risk) => risk.level === "high").slice(0, 5)) {
    warnings.push({
      severity: "high",
      code: "high_dependency_risk",
      path: item.path,
      message: `${item.path} is a high-risk dependency node.`,
      detail: item.reasons.join("; ")
    });
  }

  for (const cycle of metrics.circularDependencies.slice(0, 5)) {
    warnings.push({
      severity: "high",
      code: "circular_dependency",
      message: "Circular dependency path detected.",
      detail: cycle
    });
  }

  for (const boundary of architecture.boundaries.filter((item) => item.dependencies >= 3).slice(0, 5)) {
    warnings.push({
      severity: "medium",
      code: "module_boundary_pressure",
      message: `${boundary.from} depends on ${boundary.to} across ${boundary.dependencies} edge(s).`,
      detail: "Review whether this boundary should be formalized or simplified."
    });
  }

  if (impact && impact.blastRadius >= 3) {
    warnings.push({
      severity: impact.risk.level === "high" ? "high" : "medium",
      code: "large_blast_radius",
      message: `This change affects ${impact.blastRadius} downstream file(s).`,
      detail: impact.directDependents.join(", ")
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    warnings,
    recommendations: guidanceRecommendations(warnings, impact)
  };
}

function guidanceRecommendations(warnings, impact) {
  const recommendations = [];
  if (warnings.some((warning) => warning.code === "high_dependency_risk")) {
    recommendations.push("Prioritize tests around high-risk dependency nodes before large changes.");
  }
  if (warnings.some((warning) => warning.code === "circular_dependency")) {
    recommendations.push("Break dependency cycles before expanding affected modules.");
  }
  if (warnings.some((warning) => warning.code === "module_boundary_pressure")) {
    recommendations.push("Inspect cross-module edges for boundary drift.");
  }
  if (impact?.blastRadius) {
    recommendations.push("Review direct dependents and run targeted validation for the affected graph path.");
  }
  if (!recommendations.length) {
    recommendations.push("No major structural warnings detected.");
  }
  return recommendations;
}

