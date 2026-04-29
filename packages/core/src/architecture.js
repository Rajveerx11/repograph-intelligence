import { calculateMetrics } from "./metrics.js";

const LAYER_RULES = [
  { name: "cli", pattern: /(^|\/)(cli|commands?|bin)(\/|$)/ },
  { name: "ui", pattern: /(^|\/)(app|components?|pages?|routes?|views?|frontend|web|ui)(\/|$)/ },
  { name: "api", pattern: /(^|\/)(api|controllers?|routes?|server|handlers?)(\/|$)/ },
  { name: "domain", pattern: /(^|\/)(core|domain|models?|entities|services?)(\/|$)/ },
  { name: "data", pattern: /(^|\/)(db|database|storage|repositories|migrations?)(\/|$)/ },
  { name: "tests", pattern: /(^|\/)(test|tests|spec|fixtures?)(\/|$)/ }
];

export function inferArchitecture(graph) {
  const metrics = calculateMetrics(graph);
  const files = graph.nodes.filter((node) => node.type === "file");
  const modules = inferModules(files, graph.edges);
  const layers = inferLayers(files);
  const boundaries = inferBoundaries(modules, graph.edges);

  return {
    summary: summarizeArchitecture(modules, layers, metrics),
    modules,
    layers,
    boundaries,
    signals: {
      circularDependencies: metrics.circularDependencies.length,
      highlyCoupledModules: metrics.highlyCoupledModules,
      orphanFiles: metrics.orphanFiles
    }
  };
}

function inferModules(files, edges) {
  const grouped = new Map();
  for (const file of files) {
    const moduleName = file.path.includes("/") ? file.path.split("/")[0] : ".";
    if (!grouped.has(moduleName)) {
      grouped.set(moduleName, {
        name: moduleName,
        files: 0,
        symbols: 0,
        languages: new Set(),
        incoming: 0,
        outgoing: 0
      });
    }

    const module = grouped.get(moduleName);
    module.files += 1;
    module.symbols += file.symbolCount ?? 0;
    module.languages.add(file.language);
  }

  for (const edge of edges.filter((item) => item.scope === "internal")) {
    const fromModule = moduleFromNodeId(edge.from);
    const toModule = moduleFromNodeId(edge.to);
    if (!fromModule || !toModule || fromModule === toModule) {
      continue;
    }
    grouped.get(fromModule).outgoing += 1;
    grouped.get(toModule).incoming += 1;
  }

  return Array.from(grouped.values())
    .map((module) => ({
      ...module,
      languages: Array.from(module.languages).sort()
    }))
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name));
}

function inferLayers(files) {
  const layers = new Map();

  for (const file of files) {
    const layerName = LAYER_RULES.find((rule) => rule.pattern.test(file.path))?.name ?? "support";
    if (!layers.has(layerName)) {
      layers.set(layerName, { name: layerName, files: 0, paths: [] });
    }
    const layer = layers.get(layerName);
    layer.files += 1;
    layer.paths.push(file.path);
  }

  return Array.from(layers.values())
    .map((layer) => ({ ...layer, paths: layer.paths.sort().slice(0, 10) }))
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name));
}

function inferBoundaries(modules, edges) {
  const moduleNames = new Set(modules.map((module) => module.name));
  const boundaries = new Map();

  for (const edge of edges.filter((item) => item.scope === "internal")) {
    const fromModule = moduleFromNodeId(edge.from);
    const toModule = moduleFromNodeId(edge.to);
    if (!moduleNames.has(fromModule) || !moduleNames.has(toModule) || fromModule === toModule) {
      continue;
    }
    const key = `${fromModule}->${toModule}`;
    boundaries.set(key, {
      from: fromModule,
      to: toModule,
      dependencies: (boundaries.get(key)?.dependencies ?? 0) + 1
    });
  }

  return Array.from(boundaries.values()).sort(
    (left, right) => right.dependencies - left.dependencies || left.from.localeCompare(right.from)
  );
}

function summarizeArchitecture(modules, layers, metrics) {
  const largestModule = modules[0]?.name ?? "unknown";
  const dominantLayer = layers[0]?.name ?? "support";
  return [
    `Detected ${modules.length} top-level module(s) across ${metrics.files} file(s).`,
    `Largest module: ${largestModule}.`,
    `Dominant layer: ${dominantLayer}.`,
    `Internal dependency density: ${metrics.dependencyDensity}.`,
    metrics.circularDependencies.length
      ? `Detected ${metrics.circularDependencies.length} circular dependency path(s).`
      : "No circular dependency paths detected."
  ].join(" ");
}

function moduleFromNodeId(nodeId) {
  const path = nodeId.replace(/^file:/, "");
  if (!path || path.startsWith("package:")) {
    return null;
  }
  return path.includes("/") ? path.split("/")[0] : ".";
}

