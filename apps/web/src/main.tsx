import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node
} from "reactflow";
import "reactflow/dist/style.css";
import "./styles.css";
import type { RepoGraph, RepoGraphNode } from "@repograph/shared-types";

const MAX_GRAPH_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RENDERED_NODES = 5000;
const MAX_RENDERED_EDGES = 10000;
const NODE_TYPES = ["file", "function", "class", "method", "interface", "module", "package"] as const;
const EDGE_TYPES = ["contains", "imports", "exports", "references", "dependency"] as const;

const SAMPLE_GRAPH: RepoGraph = {
  version: 1,
  generatedAt: "sample",
  root: "sample",
  nodes: [
    { id: "file:src/index.ts", type: "file", label: "index.ts", path: "src/index.ts", language: "typescript", symbolCount: 1 },
    { id: "file:src/util.ts", type: "file", label: "util.ts", path: "src/util.ts", language: "typescript", symbolCount: 1 },
    { id: "package:express", type: "package", label: "express" }
  ],
  edges: [
    { id: "imports:index-util", type: "imports", from: "file:src/index.ts", to: "file:src/util.ts", scope: "internal" },
    { id: "dependency:index-express", type: "dependency", from: "file:src/index.ts", to: "package:express", scope: "external" }
  ]
};

function App() {
  const [graph, setGraph] = useState<RepoGraph>(SAMPLE_GRAPH);
  const [filter, setFilter] = useState<"all" | "files" | "packages">("all");
  const [selected, setSelected] = useState<RepoGraphNode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const visibleGraph = useMemo(() => filterGraph(graph, filter), [graph, filter]);
  const flowNodes = useMemo(() => toFlowNodes(visibleGraph.nodes, selected?.id), [visibleGraph.nodes, selected?.id]);
  const flowEdges = useMemo(() => toFlowEdges(visibleGraph.edges), [visibleGraph.edges]);
  const summary = useMemo(() => summarizeGraph(graph), [graph]);

  return (
    <main className="app-shell h-screen overflow-hidden bg-substrate text-graphite">
      <header className="workspace-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>RepoGraph Intelligence</h1>
            <p>{graph.root === "sample" ? "Sample workspace" : graph.root}</p>
          </div>
        </div>

        <div className="header-metrics" aria-label="Graph summary">
          <Metric label="Nodes" value={graph.nodes.length} />
          <Metric label="Edges" value={graph.edges.length} />
          <Metric label="Files" value={summary.files} />
          <Metric label="Packages" value={summary.packages} />
        </div>

        <div className="header-actions">
          <div className="segmented-control" aria-label="Node filter">
            {[
              ["all", "All"],
              ["files", "Files"],
              ["packages", "Packages"]
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                type="button"
                onClick={() => setFilter(value as typeof filter)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="load-button">
            <UploadIcon />
            <span>Load graph</span>
            <input className="sr-only" type="file" accept="application/json" onChange={(event) => loadGraphFile(event, setGraph, setLoadError)} />
          </label>
        </div>
      </header>

      <section className="workspace-grid">
        <div className="graph-stage">
          {loadError ? (
            <p className="load-error">{loadError}</p>
          ) : null}
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            minZoom={0.18}
            maxZoom={1.6}
            onPaneClick={() => setSelected(null)}
            onNodeClick={(_, node) => setSelected(graph.nodes.find((item) => item.id === node.id) ?? null)}
          >
            <Background color="#cbd5e1" gap={22} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <p>Inspector</p>
            <span>{visibleGraph.nodes.length} visible</span>
          </div>
          {selected ? (
            <>
              <div className="selection-card">
                <span className={`node-badge ${selected.type}`}>{selected.type}</span>
                <h2>{selected.label}</h2>
                <p>{selected.path ?? selected.id}</p>
              </div>
              <dl className="field-grid">
                <Field label="Path" value={selected.path ?? "none"} />
                <Field label="Language" value={selected.language ?? "none"} />
                <Field label="Symbols" value={String(selected.symbolCount ?? 0)} />
                <Field label="Imports" value={String(selected.importCount ?? 0)} />
                <Field label="Exports" value={String(selected.exportCount ?? 0)} />
                <Field label="References" value={String(selected.referenceCount ?? 0)} />
              </dl>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-glyph" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2>No node selected</h2>
              <p>Choose a graph node to inspect its structural metadata.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 3v9m0-9 3.5 3.5M10 3 6.5 6.5" />
      <path d="M4 12.5V15a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2.5" />
    </svg>
  );
}

function summarizeGraph(graph: RepoGraph) {
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

function filterGraph(graph: RepoGraph, filter: "all" | "files" | "packages"): RepoGraph {
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

function toFlowNodes(nodes: RepoGraphNode[], selectedId?: string): Node[] {
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

function toFlowEdges(edges: RepoGraph["edges"]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    animated: edge.scope === "external"
  }));
}

async function loadGraphFile(
  event: React.ChangeEvent<HTMLInputElement>,
  setGraph: (graph: RepoGraph) => void,
  setLoadError: (message: string | null) => void
) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    if (file.size > MAX_GRAPH_FILE_BYTES) {
      throw new Error("Graph file is too large.");
    }

    const parsed = JSON.parse(await file.text()) as unknown;
    const graph = validateGraph(parsed);
    setGraph(graph);
    setLoadError(null);
  } catch (error) {
    setLoadError(error instanceof Error ? error.message : "Graph file could not be loaded.");
  } finally {
    event.target.value = "";
  }
}

function validateGraph(value: unknown): RepoGraph {
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

createRoot(document.getElementById("root")!).render(<App />);
