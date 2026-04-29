import { inferArchitecture } from "./architecture.js";
import { calculateMetrics } from "./metrics.js";

export function summarizeRepository(graph) {
  const metrics = calculateMetrics(graph);
  const architecture = inferArchitecture(graph);
  const externalPackages = graph.nodes
    .filter((node) => node.type === "package")
    .map((node) => node.label)
    .sort();

  return {
    generatedAt: new Date().toISOString(),
    root: graph.root,
    overview: architecture.summary,
    metrics,
    architecture,
    externalPackages
  };
}

export function compressContext(graph, options = {}) {
  const maxHotspots = options.maxHotspots ?? 8;
  const maxModules = options.maxModules ?? 8;
  const summary = summarizeRepository(graph);
  const lines = [
    "# RepoGraph Context",
    "",
    summary.overview,
    "",
    "## Metrics",
    `- Files: ${summary.metrics.files}`,
    `- Symbols: ${summary.metrics.symbols}`,
    `- Internal dependencies: ${summary.metrics.internalDependencies}`,
    `- External dependencies: ${summary.metrics.externalDependencies}`,
    `- Dependency density: ${summary.metrics.dependencyDensity}`,
    `- Circular dependencies: ${summary.metrics.circularDependencies.length}`,
    "",
    "## Modules",
    ...summary.architecture.modules.slice(0, maxModules).map((module) => {
      return `- ${module.name}: ${module.files} file(s), ${module.symbols} symbol(s), ${module.languages.join(", ")}`;
    }),
    "",
    "## Hotspots",
    ...summary.metrics.hotspots.slice(0, maxHotspots).map((hotspot) => {
      return `- ${hotspot.path}: total=${hotspot.totalDegree}, incoming=${hotspot.incoming}, outgoing=${hotspot.outgoing}`;
    })
  ];

  if (summary.externalPackages.length) {
    lines.push("", "## External Packages");
    lines.push(...summary.externalPackages.slice(0, 20).map((name) => `- ${name}`));
  }

  return `${lines.join("\n")}\n`;
}

