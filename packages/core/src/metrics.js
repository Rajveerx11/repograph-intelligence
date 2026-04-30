export function calculateMetrics(graph) {
  const fileNodes = graph.nodes.filter((node) => node.type === "file");
  const symbolNodes = graph.nodes.filter((node) => isSymbolType(node.type));
  const internalEdges = graph.edges.filter((edge) => edge.scope === "internal");
  const externalEdges = graph.edges.filter((edge) => edge.scope === "external");
  const degrees = calculateDegrees(fileNodes, internalEdges);
  const cycles = findCycles(fileNodes, internalEdges);
  const averageDegree = fileNodes.length
    ? Array.from(degrees.values()).reduce((sum, degree) => sum + degree.total, 0) / fileNodes.length
    : 0;

  return {
    files: fileNodes.length,
    symbols: symbolNodes.length,
    edges: graph.edges.length,
    internalDependencies: internalEdges.length,
    externalDependencies: externalEdges.length,
    dependencyDensity: density(fileNodes.length, internalEdges.length),
    circularDependencies: cycles,
    orphanFiles: fileNodes
      .filter((node) => (degrees.get(node.id)?.total ?? 0) === 0)
      .map((node) => node.path),
    hotspots: topFiles(fileNodes, degrees, 10),
    highlyCoupledModules: topFiles(fileNodes, degrees, 10).filter((item) => {
      const threshold = Math.max(3, averageDegree * 2);
      return item.totalDegree >= threshold;
    })
  };
}

function calculateDegrees(fileNodes, internalEdges) {
  const degrees = new Map(
    fileNodes.map((node) => [node.id, { incoming: 0, outgoing: 0, total: 0 }])
  );

  for (const edge of internalEdges) {
    const from = degrees.get(edge.from);
    const to = degrees.get(edge.to);
    if (from) {
      from.outgoing += 1;
      from.total += 1;
    }
    if (to) {
      to.incoming += 1;
      to.total += 1;
    }
  }

  return degrees;
}

function density(fileCount, internalEdgeCount) {
  if (fileCount < 2) {
    return 0;
  }
  return Number((internalEdgeCount / (fileCount * (fileCount - 1))).toFixed(4));
}

function topFiles(fileNodes, degrees, limit) {
  return fileNodes
    .map((node) => {
      const degree = degrees.get(node.id) ?? { incoming: 0, outgoing: 0, total: 0 };
      return {
        path: node.path,
        incoming: degree.incoming,
        outgoing: degree.outgoing,
        totalDegree: degree.total
      };
    })
    .filter((item) => item.totalDegree > 0)
    .sort((left, right) => right.totalDegree - left.totalDegree || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function findCycles(fileNodes, internalEdges) {
  const graph = new Map(fileNodes.map((node) => [node.id, []]));
  for (const edge of internalEdges) {
    graph.get(edge.from)?.push(edge.to);
  }

  const state = new Map();
  const stack = [];
  const cycles = new Set();

  function visit(nodeId) {
    state.set(nodeId, "visiting");
    stack.push(nodeId);

    for (const next of graph.get(nodeId) ?? []) {
      if (!state.has(next)) {
        visit(next);
        continue;
      }

      if (state.get(next) === "visiting") {
        const start = stack.indexOf(next);
        const cycle = stack.slice(start).concat(next).map(labelForNode);
        cycles.add(cycle.join(" -> "));
      }
    }

    stack.pop();
    state.set(nodeId, "visited");
  }

  for (const node of fileNodes) {
    if (!state.has(node.id)) {
      visit(node.id);
    }
  }

  return Array.from(cycles).sort();
}

function labelForNode(nodeId) {
  return nodeId.replace(/^file:/, "");
}

function isSymbolType(type) {
  return type === "class" || type === "function" || type === "interface" || type === "method";
}
