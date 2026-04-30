import type { Edge, Node } from "reactflow";
import type { RepoGraph, RepoGraphNode } from "@repograph/shared-types";
import { EDGE_TYPES, MAX_RENDERED_EDGES, MAX_RENDERED_NODES, NODE_TYPES } from "./constants";
import type { GraphFilter } from "./types";

export function summarizeGraph(graph: RepoGraph) {
  return graph.nodes.reduce(
    (summary, node) => {
      if (node.type === "file") {
        summary.files += 1;
      }
      if (node.type === "package") {
        summary.packages += 1;
      }
      return summary;
    },
    { files: 0, packages: 0 }
  );
}

export function summarizeRepositoryForDisplay(graph: RepoGraph) {
  const summary = summarizeGraph(graph);
  return {
    root: graph.root,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    files: summary.files,
    packages: summary.packages
  };
}

export function filterGraph(graph: RepoGraph, filter: GraphFilter): RepoGraph {
  if (filter === "all") {
    return graph;
  }
  const allowedTypes = filter === "files" ? new Set(["file"]) : new Set(["package"]);
  const nodes = graph.nodes.filter((node) => allowedTypes.has(node.type));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  };
}

export function toFlowNodes(nodes: RepoGraphNode[], selectedId?: string): Node[] {
  return nodes.map((node, index) => ({
    id: node.id,
    type: "default",
    position: {
      x: (index % 5) * 220,
      y: Math.floor(index / 5) * 140
    },
    data: {
      label: node.path ?? node.label
    },
    className: [
      "graph-node",
      `${node.type}-node`,
      node.id === selectedId ? "selected-node" : ""
    ].filter(Boolean).join(" ")
  }));
}

export function toFlowEdges(edges: RepoGraph["edges"]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    animated: edge.scope === "external"
  }));
}

export function validateGraph(value: unknown): RepoGraph {
  if (!isRecord(value)) {
    throw new Error("Graph file must contain a JSON object.");
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("Graph file must include nodes and edges arrays.");
  }

  if (value.nodes.length > MAX_RENDERED_NODES || value.edges.length > MAX_RENDERED_EDGES) {
    throw new Error("Graph is too large for the browser explorer.");
  }

  const nodes = value.nodes.map(validateNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = value.edges.map((edge) => validateEdge(edge, nodeIds));

  return {
    version: typeof value.version === "number" ? value.version : 1,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "unknown",
    root: typeof value.root === "string" ? value.root : "unknown",
    nodes,
    edges
  };
}

function validateNode(value: unknown): RepoGraphNode {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string" || typeof value.type !== "string") {
    throw new Error("Graph contains an invalid node.");
  }

  if (!isNodeType(value.type)) {
    throw new Error("Graph contains an unsupported node type.");
  }

  return {
    id: value.id,
    type: value.type,
    label: value.label,
    path: typeof value.path === "string" ? value.path : undefined,
    language: value.language === "javascript" || value.language === "typescript" || value.language === "python" ? value.language : undefined,
    lineCount: typeof value.lineCount === "number" ? value.lineCount : undefined,
    semanticText: typeof value.semanticText === "string" ? value.semanticText : undefined,
    symbolCount: typeof value.symbolCount === "number" ? value.symbolCount : undefined,
    importCount: typeof value.importCount === "number" ? value.importCount : undefined,
    exportCount: typeof value.exportCount === "number" ? value.exportCount : undefined,
    referenceCount: typeof value.referenceCount === "number" ? value.referenceCount : undefined
  };
}

function validateEdge(value: unknown, nodeIds: Set<string>): RepoGraph["edges"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.from !== "string" || typeof value.to !== "string" || typeof value.type !== "string") {
    throw new Error("Graph contains an invalid edge.");
  }

  if (!nodeIds.has(value.from) || !nodeIds.has(value.to)) {
    throw new Error("Graph contains an edge that references a missing node.");
  }

  if (!isEdgeType(value.type)) {
    throw new Error("Graph contains an unsupported edge type.");
  }

  return {
    id: value.id,
    type: value.type,
    from: value.from,
    to: value.to,
    scope: value.scope === "internal" || value.scope === "external" ? value.scope : undefined,
    specifier: typeof value.specifier === "string" ? value.specifier : undefined,
    exportedName: typeof value.exportedName === "string" ? value.exportedName : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeType(value: string): value is RepoGraphNode["type"] {
  return NODE_TYPES.some((type) => type === value);
}

function isEdgeType(value: string): value is RepoGraph["edges"][number]["type"] {
  return EDGE_TYPES.some((type) => type === value);
}

