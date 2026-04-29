import { inferArchitecture } from "./architecture.js";
import { calculateMetrics } from "./metrics.js";

const FILE_PREFIX = "file:";

export function analyzeImpact(graph, changedPaths, options = {}) {
  const maxDepth = options.maxDepth ?? Infinity;
  const fileNodes = fileNodeMap(graph);
  const changedFileIds = normalizeChangedPaths(changedPaths, fileNodes);
  const reverseGraph = adjacency(graph.edges.filter((edge) => edge.scope === "internal"), "to", "from");
  const forwardGraph = adjacency(graph.edges.filter((edge) => edge.scope === "internal"), "from", "to");

  const affected = new Map();
  const dependencyPaths = [];

  for (const changedId of changedFileIds) {
    const queue = [{ id: changedId, depth: 0, path: [changedId] }];
    const visited = new Set([changedId]);

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) {
        continue;
      }

      for (const next of reverseGraph.get(current.id) ?? []) {
        if (visited.has(next)) {
          continue;
        }
        visited.add(next);
        const nextPath = current.path.concat(next);
        affected.set(next, Math.min(affected.get(next) ?? Infinity, current.depth + 1));
        dependencyPaths.push(nextPath.map(pathFromFileId));
        queue.push({ id: next, depth: current.depth + 1, path: nextPath });
      }
    }
  }

  const directDependents = Array.from(affected)
    .filter(([, depth]) => depth === 1)
    .map(([id]) => pathFromFileId(id))
    .sort();
  const transitiveDependents = Array.from(affected)
    .filter(([, depth]) => depth > 1)
    .map(([id, depth]) => ({ path: pathFromFileId(id), depth }))
    .sort((left, right) => left.depth - right.depth || left.path.localeCompare(right.path));
  const changedDependencies = Array.from(changedFileIds)
    .flatMap((id) => Array.from(forwardGraph.get(id) ?? []).map(pathFromFileId))
    .sort();
  const risk = classifyImpactRisk({
    changedCount: changedFileIds.size,
    affectedCount: affected.size,
    directCount: directDependents.length
  });

  return {
    changedFiles: Array.from(changedFileIds).map(pathFromFileId).sort(),
    directDependents,
    transitiveDependents,
    affectedFiles: Array.from(affected.keys()).map(pathFromFileId).sort(),
    changedDependencies: Array.from(new Set(changedDependencies)),
    dependencyPaths,
    blastRadius: affected.size,
    risk
  };
}

export function scoreDependencyRisk(graph) {
  const metrics = calculateMetrics(graph);
  const internalEdges = graph.edges.filter((edge) => edge.scope === "internal");
  const externalEdges = graph.edges.filter((edge) => edge.scope === "external");
  const files = graph.nodes.filter((node) => node.type === "file");
  const cycles = metrics.circularDependencies.flatMap((cycle) => cycle.split(" -> "));

  return files
    .map((file) => {
      const incoming = internalEdges.filter((edge) => edge.to === file.id).length;
      const outgoing = internalEdges.filter((edge) => edge.from === file.id).length;
      const external = externalEdges.filter((edge) => edge.from === file.id).length;
      const inCycle = cycles.includes(file.path);
      const score = Math.min(100, Math.round(
        incoming * 18 +
        outgoing * 10 +
        external * 6 +
        (file.symbolCount ?? 0) * 2 +
        (inCycle ? 25 : 0)
      ));

      return {
        path: file.path,
        score,
        level: riskLevel(score),
        reasons: riskReasons({ incoming, outgoing, external, inCycle, symbolCount: file.symbolCount ?? 0 }),
        incoming,
        outgoing,
        externalDependencies: external,
        symbolCount: file.symbolCount ?? 0
      };
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

export function simulateRefactor(graph, changedPaths, options = {}) {
  const impact = analyzeImpact(graph, changedPaths, options);
  const risks = scoreDependencyRisk(graph);
  const riskByPath = new Map(risks.map((item) => [item.path, item]));
  const changedRisk = impact.changedFiles.map((filePath) => riskByPath.get(filePath)).filter(Boolean);
  const affectedRisk = impact.affectedFiles.map((filePath) => riskByPath.get(filePath)).filter(Boolean);
  const architecture = inferArchitecture(graph);
  const touchedModules = touchedTopLevelModules([...impact.changedFiles, ...impact.affectedFiles]);

  return {
    changeSet: impact.changedFiles,
    touchedModules,
    impact,
    risk: {
      level: aggregateRiskLevel([...changedRisk, ...affectedRisk], impact.risk.level),
      changedFiles: changedRisk,
      highestAffectedFiles: affectedRisk.slice(0, 10)
    },
    architecturalShift: {
      touchedModules,
      boundaryCrossings: architecture.boundaries.filter((boundary) => {
        return touchedModules.includes(boundary.from) || touchedModules.includes(boundary.to);
      })
    },
    recommendations: recommendationsForImpact(impact, changedRisk, affectedRisk)
  };
}

export function analyzePullRequest(graph, changedPaths, options = {}) {
  const simulation = simulateRefactor(graph, changedPaths, options);
  const metrics = calculateMetrics(graph);

  return {
    changedFiles: simulation.changeSet,
    summary: summarizePrImpact(simulation, metrics),
    impact: simulation.impact,
    risk: simulation.risk,
    architecturalShift: simulation.architecturalShift,
    recommendations: simulation.recommendations
  };
}

export function analyzeChangedFiles(graph, changedPaths, options = {}) {
  return analyzePullRequest(graph, changedPaths, options);
}

function fileNodeMap(graph) {
  return new Map(graph.nodes.filter((node) => node.type === "file").map((node) => [node.path, node]));
}

function normalizeChangedPaths(changedPaths, fileNodes) {
  const normalized = new Set();
  for (const changedPath of changedPaths) {
    const cleanPath = normalizePath(changedPath);
    if (fileNodes.has(cleanPath)) {
      normalized.add(`${FILE_PREFIX}${cleanPath}`);
      continue;
    }

    const matchingPath = Array.from(fileNodes.keys()).find((filePath) => filePath.endsWith(cleanPath));
    if (matchingPath) {
      normalized.add(`${FILE_PREFIX}${matchingPath}`);
    }
  }
  return normalized;
}

function adjacency(edges, fromKey, toKey) {
  const graph = new Map();
  for (const edge of edges) {
    if (!edge[fromKey].startsWith(FILE_PREFIX) || !edge[toKey].startsWith(FILE_PREFIX)) {
      continue;
    }
    if (!graph.has(edge[fromKey])) {
      graph.set(edge[fromKey], new Set());
    }
    graph.get(edge[fromKey]).add(edge[toKey]);
  }
  return graph;
}

function classifyImpactRisk({ changedCount, affectedCount, directCount }) {
  const score = Math.min(100, changedCount * 8 + affectedCount * 12 + directCount * 10);
  return {
    score,
    level: riskLevel(score),
    reason: `${affectedCount} affected file(s), ${directCount} direct dependent(s)`
  };
}

function riskLevel(score) {
  if (score >= 70) {
    return "high";
  }
  if (score >= 35) {
    return "medium";
  }
  return "low";
}

function riskReasons({ incoming, outgoing, external, inCycle, symbolCount }) {
  const reasons = [];
  if (incoming) {
    reasons.push(`${incoming} downstream file(s) depend on it`);
  }
  if (outgoing) {
    reasons.push(`${outgoing} internal dependency edge(s)`);
  }
  if (external) {
    reasons.push(`${external} external package dependency edge(s)`);
  }
  if (symbolCount >= 5) {
    reasons.push(`${symbolCount} exported/local symbol(s)`);
  }
  if (inCycle) {
    reasons.push("participates in a circular dependency");
  }
  return reasons.length ? reasons : ["isolated or low-connectivity file"];
}

function aggregateRiskLevel(risks, fallbackLevel) {
  const highestScore = risks.reduce((max, item) => Math.max(max, item.score), 0);
  const level = riskLevel(highestScore);
  if (level === "low" && fallbackLevel !== "low") {
    return fallbackLevel;
  }
  return level;
}

function recommendationsForImpact(impact, changedRisk, affectedRisk) {
  const recommendations = [];
  if (impact.blastRadius > 0) {
    recommendations.push("Run tests that cover direct and transitive dependents before merging.");
  }
  if (impact.directDependents.length >= 3) {
    recommendations.push("Consider introducing a compatibility layer or staged migration for high fan-in changes.");
  }
  if (changedRisk.some((item) => item.level === "high") || affectedRisk.some((item) => item.level === "high")) {
    recommendations.push("Review public contracts and module boundaries; this change touches high-risk graph nodes.");
  }
  if (!recommendations.length) {
    recommendations.push("Low structural risk detected; standard local validation should be sufficient.");
  }
  return recommendations;
}

function summarizePrImpact(simulation, metrics) {
  return [
    `${simulation.changeSet.length} changed file(s) touch ${simulation.touchedModules.length} module(s).`,
    `Blast radius: ${simulation.impact.blastRadius} affected file(s).`,
    `Risk: ${simulation.risk.level}.`,
    `Repository density: ${metrics.dependencyDensity}.`
  ].join(" ");
}

function touchedTopLevelModules(paths) {
  return Array.from(new Set(paths.map((filePath) => {
    return filePath.includes("/") ? filePath.split("/")[0] : ".";
  }))).sort();
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathFromFileId(fileId) {
  return fileId.replace(FILE_PREFIX, "");
}
