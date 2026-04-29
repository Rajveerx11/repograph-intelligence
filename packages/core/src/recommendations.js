import { inferArchitecture } from "./architecture.js";
import { scoreDependencyRisk } from "./impact.js";
import { calculateMetrics } from "./metrics.js";
import { analyzeSecurityRisk } from "./security.js";

export function recommendArchitecture(graph, options = {}) {
  const metrics = calculateMetrics(graph);
  const architecture = inferArchitecture(graph);
  const risks = scoreDependencyRisk(graph);
  const security = options.security ?? analyzeSecurityRisk(graph);
  const recommendations = [];

  for (const cycle of metrics.circularDependencies.slice(0, 5)) {
    recommendations.push({
      priority: "high",
      type: "decouple-cycle",
      title: "Break circular dependency",
      target: cycle,
      reason: "Cycles make impact analysis, testing, and security review less predictable.",
      actions: [
        "Move shared contracts into a lower-level module.",
        "Invert one dependency through an interface or adapter.",
        "Add tests around the current cycle before changing it."
      ]
    });
  }

  for (const risk of risks.filter((item) => item.level === "high").slice(0, 5)) {
    recommendations.push({
      priority: "high",
      type: "stabilize-hotspot",
      title: "Stabilize high-risk dependency node",
      target: risk.path,
      reason: risk.reasons.join("; "),
      actions: [
        "Document the public contract of this file.",
        "Add targeted tests around direct dependents.",
        "Split unrelated responsibilities if the file owns multiple concepts."
      ]
    });
  }

  for (const boundary of architecture.boundaries.filter((item) => item.dependencies >= 3).slice(0, 5)) {
    recommendations.push({
      priority: "medium",
      type: "formalize-boundary",
      title: "Formalize module boundary",
      target: `${boundary.from}->${boundary.to}`,
      reason: `${boundary.from} depends on ${boundary.to} through ${boundary.dependencies} edge(s).`,
      actions: [
        "Create a small public API for the target module.",
        "Route imports through an index or facade.",
        "Review whether responsibilities should move across the boundary."
      ]
    });
  }

  for (const finding of security.findings.filter((item) => item.severity === "high").slice(0, 5)) {
    recommendations.push({
      priority: "high",
      type: "reduce-security-blast-zone",
      title: "Reduce security-sensitive blast radius",
      target: finding.target,
      reason: finding.message,
      actions: [
        "Add focused validation for downstream paths.",
        "Separate policy-sensitive code from broad utility modules.",
        "Review external dependency exposure for this path."
      ]
    });
  }

  for (const module of architecture.modules.filter((item) => item.files >= 10 && item.outgoing >= 5).slice(0, 5)) {
    recommendations.push({
      priority: "medium",
      type: "modularize-large-area",
      title: "Review large module responsibilities",
      target: module.name,
      reason: `${module.name} contains ${module.files} file(s) and ${module.outgoing} outgoing cross-module edge(s).`,
      actions: [
        "Group files by domain behavior rather than technical category.",
        "Extract stable interfaces before moving files.",
        "Use impact analysis to stage the refactor."
      ]
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: "low",
      type: "maintain-baseline",
      title: "Maintain current architecture baseline",
      target: "repository",
      reason: "No major cycle, hotspot, boundary, or security blast-radius pressure was detected.",
      actions: [
        "Keep graph analysis in CI for large changes.",
        "Track dependency risk as the repository grows."
      ]
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: summarizeRecommendations(recommendations),
    recommendations: dedupeRecommendations(recommendations).slice(0, Number(options.limit ?? 20)),
    signals: {
      circularDependencies: metrics.circularDependencies.length,
      highRiskFiles: risks.filter((item) => item.level === "high").length,
      highSecurityFindings: security.findings.filter((item) => item.severity === "high").length,
      boundaryPressure: architecture.boundaries.filter((item) => item.dependencies >= 3).length
    }
  };
}

function dedupeRecommendations(recommendations) {
  const seen = new Set();
  const deduped = [];
  for (const recommendation of recommendations) {
    const key = `${recommendation.type}:${recommendation.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(recommendation);
  }
  return deduped.sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority));
}

function summarizeRecommendations(recommendations) {
  const high = recommendations.filter((item) => item.priority === "high").length;
  const medium = recommendations.filter((item) => item.priority === "medium").length;
  const low = recommendations.filter((item) => item.priority === "low").length;
  return `${high} high, ${medium} medium, and ${low} low architecture recommendation(s).`;
}

function priorityRank(priority) {
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}
