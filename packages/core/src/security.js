import { inferArchitecture } from "./architecture.js";
import { analyzeImpact, scoreDependencyRisk } from "./impact.js";
import { calculateMetrics } from "./metrics.js";

const SENSITIVE_PATH_RULES = [
  { label: "authentication", pattern: /(auth|session|login|oauth|jwt|token)/i },
  { label: "secrets", pattern: /(secret|credential|password|key|cert|vault)/i },
  { label: "payments", pattern: /(payment|billing|invoice|stripe|checkout)/i },
  { label: "authorization", pattern: /(permission|policy|role|access|acl)/i },
  { label: "data-access", pattern: /(database|db|migration|query|sql)/i }
];

export function analyzeSecurityRisk(graph, options = {}) {
  const metrics = calculateMetrics(graph);
  const architecture = inferArchitecture(graph);
  const dependencyRisk = scoreDependencyRisk(graph);
  const fileNodes = graph.nodes.filter((node) => node.type === "file");
  const externalEdges = graph.edges.filter((edge) => edge.scope === "external");
  const packageSurfaces = packageRiskSurfaces(externalEdges);
  const criticalBlastZones = dependencyRisk
    .filter((item) => item.level !== "low")
    .slice(0, Number(options.limit ?? 10))
    .map((item) => {
      const impact = analyzeImpact(graph, [item.path]);
      return {
        path: item.path,
        risk: item.level,
        score: item.score,
        blastRadius: impact.blastRadius,
        directDependents: impact.directDependents
      };
    });
  const sensitiveFiles = fileNodes
    .map((file) => ({ file, tags: sensitiveTags(file.path) }))
    .filter((item) => item.tags.length)
    .map((item) => {
      const impact = analyzeImpact(graph, [item.file.path]);
      return {
        path: item.file.path,
        tags: item.tags,
        blastRadius: impact.blastRadius,
        dependencyRisk: dependencyRisk.find((risk) => risk.path === item.file.path)?.level ?? "low"
      };
    });

  const findings = [
    ...sensitiveFindings(sensitiveFiles),
    ...packageFindings(packageSurfaces),
    ...cycleFindings(metrics.circularDependencies),
    ...boundaryFindings(architecture.boundaries)
  ].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));

  return {
    summary: summarizeSecurity(findings, criticalBlastZones, packageSurfaces),
    findings,
    sensitiveFiles,
    packageSurfaces,
    criticalBlastZones,
    unsafeCoupling: {
      circularDependencies: metrics.circularDependencies,
      highPressureBoundaries: architecture.boundaries.filter((boundary) => boundary.dependencies >= 3)
    }
  };
}

function packageRiskSurfaces(externalEdges) {
  const packages = new Map();
  for (const edge of externalEdges) {
    const packageName = edge.to.replace(/^package:/, "");
    if (!packages.has(packageName)) {
      packages.set(packageName, { name: packageName, importers: new Set(), specifiers: new Set() });
    }
    const item = packages.get(packageName);
    item.importers.add(edge.from.replace(/^file:/, ""));
    item.specifiers.add(edge.specifier ?? packageName);
  }

  return Array.from(packages.values())
    .map((item) => ({
      name: item.name,
      importers: Array.from(item.importers).sort(),
      importerCount: item.importers.size,
      specifiers: Array.from(item.specifiers).sort(),
      builtin: item.name.startsWith("node:"),
      exposure: exposureLevel(item.importers.size)
    }))
    .sort((left, right) => right.importerCount - left.importerCount || left.name.localeCompare(right.name));
}

function sensitiveFindings(sensitiveFiles) {
  return sensitiveFiles
    .filter((item) => item.blastRadius > 0 || item.dependencyRisk !== "low")
    .map((item) => ({
      severity: item.dependencyRisk === "high" || item.blastRadius >= 5 ? "high" : "medium",
      type: "sensitive_blast_zone",
      target: item.path,
      message: `${item.path} appears security-sensitive and affects ${item.blastRadius} downstream file(s).`,
      evidence: item.tags
    }));
}

function packageFindings(packageSurfaces) {
  return packageSurfaces
    .filter((item) => !item.builtin && item.importerCount >= 3)
    .map((item) => ({
      severity: item.importerCount >= 8 ? "high" : "medium",
      type: "wide_external_dependency_surface",
      target: item.name,
      message: `${item.name} is imported by ${item.importerCount} file(s).`,
      evidence: item.importers.slice(0, 5)
    }));
}

function cycleFindings(cycles) {
  return cycles.slice(0, 5).map((cycle) => ({
    severity: "high",
    type: "circular_dependency_security_surface",
    target: "dependency-cycle",
    message: "Circular dependencies make security-sensitive changes harder to isolate.",
    evidence: [cycle]
  }));
}

function boundaryFindings(boundaries) {
  return boundaries
    .filter((boundary) => boundary.dependencies >= 3)
    .slice(0, 5)
    .map((boundary) => ({
      severity: "medium",
      type: "boundary_pressure",
      target: `${boundary.from}->${boundary.to}`,
      message: `${boundary.from} depends on ${boundary.to} across ${boundary.dependencies} edge(s).`,
      evidence: [`${boundary.dependencies} dependency edge(s)`]
    }));
}

function summarizeSecurity(findings, criticalBlastZones, packageSurfaces) {
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const widestPackage = packageSurfaces.find((item) => !item.builtin)?.name ?? "none";
  return [
    `${high} high and ${medium} medium security architecture finding(s).`,
    `${criticalBlastZones.length} critical blast zone candidate(s).`,
    `Widest external package surface: ${widestPackage}.`
  ].join(" ");
}

function sensitiveTags(filePath) {
  return SENSITIVE_PATH_RULES
    .filter((rule) => rule.pattern.test(filePath))
    .map((rule) => rule.label);
}

function exposureLevel(importerCount) {
  if (importerCount >= 8) {
    return "high";
  }
  if (importerCount >= 3) {
    return "medium";
  }
  return "low";
}

function severityRank(severity) {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}
