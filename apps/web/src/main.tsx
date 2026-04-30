import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";
import "reactflow/dist/style.css";
import "./styles.css";
import type { RepoGraph, RepoGraphNode } from "@repograph/shared-types";
import { findGraphNode, formatPayload, runRepoAction } from "./api";
import { ACTIONS, FILTERS, MAX_GRAPH_FILE_BYTES, SAMPLE_GRAPH } from "./constants";
import {
  filterGraph,
  summarizeGraph,
  summarizeRepositoryForDisplay,
  toFlowEdges,
  toFlowNodes,
  validateGraph
} from "./graph-utils";
import type { ActionId, ActionResult, GraphFilter } from "./types";

function App() {
  const [graph, setGraph] = useState<RepoGraph>(SAMPLE_GRAPH);
  const [filter, setFilter] = useState<GraphFilter>("all");
  const [selected, setSelected] = useState<RepoGraphNode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<ActionId | null>(null);
  const [agentQuery, setAgentQuery] = useState("");
  const [changedFiles, setChangedFiles] = useState("");

  const visibleGraph = useMemo(() => filterGraph(graph, filter), [graph, filter]);
  const flowNodes = useMemo(() => toFlowNodes(visibleGraph.nodes, selected?.id), [visibleGraph.nodes, selected?.id]);
  const flowEdges = useMemo(() => toFlowEdges(visibleGraph.edges), [visibleGraph.edges]);
  const summary = useMemo(() => summarizeGraph(graph), [graph]);

  async function handleAction(action: ActionId) {
    setRunningAction(action);
    setActionError(null);

    try {
      const result = await runRepoAction(action, { query: agentQuery, changedFiles });
      if (result.graph) {
        setGraph(result.graph);
        setSelected(null);
      }
      setActionResult(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setRunningAction(null);
    }
  }

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
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={filter === item.id ? "active" : ""}
                type="button"
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="load-button">
            <UploadIcon />
            <span>Load graph</span>
            <input
              className="sr-only"
              type="file"
              accept="application/json"
              onChange={(event) => loadGraphFile(event, setGraph, setLoadError, setActionResult)}
            />
          </label>
        </div>
      </header>

      <section className="workspace-grid">
        <div className="graph-stage">
          {loadError ? <p className="load-error">{loadError}</p> : null}
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            minZoom={0.18}
            maxZoom={1.6}
            onPaneClick={() => setSelected(null)}
            onNodeClick={(_, node) => setSelected(findGraphNode(graph, node.id))}
          >
            <Background color="#cbd5e1" gap={22} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <p>Control Center</p>
            <span>{visibleGraph.nodes.length} visible</span>
          </div>

          <ActionConsole
            actionError={actionError}
            actionResult={actionResult}
            agentQuery={agentQuery}
            changedFiles={changedFiles}
            runningAction={runningAction}
            onAction={handleAction}
            onAgentQueryChange={setAgentQuery}
            onChangedFilesChange={setChangedFiles}
          />

          <Inspector selected={selected} />
        </aside>
      </section>
    </main>
  );
}

function ActionConsole({
  actionError,
  actionResult,
  agentQuery,
  changedFiles,
  runningAction,
  onAction,
  onAgentQueryChange,
  onChangedFilesChange
}: {
  actionError: string | null;
  actionResult: ActionResult | null;
  agentQuery: string;
  changedFiles: string;
  runningAction: ActionId | null;
  onAction: (action: ActionId) => void;
  onAgentQueryChange: (value: string) => void;
  onChangedFilesChange: (value: string) => void;
}) {
  return (
    <section className="action-console" aria-label="RepoGraph actions">
      <div className="action-inputs">
        <label>
          AI query
          <input
            type="text"
            value={agentQuery}
            placeholder="auth flow, routing, storage"
            onChange={(event) => onAgentQueryChange(event.target.value)}
          />
        </label>
        <label>
          Changed files
          <input
            type="text"
            value={changedFiles}
            placeholder="src/auth.ts, src/api.ts"
            onChange={(event) => onChangedFilesChange(event.target.value)}
          />
        </label>
      </div>
      <div className="action-grid">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            className={action.tone === "primary" ? "primary" : ""}
            type="button"
            disabled={runningAction !== null}
            onClick={() => onAction(action.id)}
          >
            {runningAction === action.id ? "Running..." : action.label}
          </button>
        ))}
      </div>
      {actionError ? <p className="action-error">{actionError}</p> : null}
      {actionResult ? (
        <article className="action-result">
          <h2>{actionResult.title}</h2>
          <p>{actionResult.message}</p>
          <pre>{formatPayload(actionResult.payload)}</pre>
        </article>
      ) : null}
    </section>
  );
}

function Inspector({ selected }: { selected: RepoGraphNode | null }) {
  if (!selected) {
    return (
      <div className="empty-state">
        <div className="empty-glyph" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2>No node selected</h2>
        <p>Choose a graph node to inspect its structural metadata.</p>
      </div>
    );
  }

  return (
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

async function loadGraphFile(
  event: React.ChangeEvent<HTMLInputElement>,
  setGraph: (graph: RepoGraph) => void,
  setLoadError: (message: string | null) => void,
  setActionResult: (result: ActionResult | null) => void
) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    if (file.size > MAX_GRAPH_FILE_BYTES) {
      throw new Error("Graph file is too large.");
    }

    const graph = validateGraph(JSON.parse(await file.text()) as unknown);
    setGraph(graph);
    setLoadError(null);
    setActionResult({
      title: "Graph loaded",
      message: `${file.name} is now visible in the explorer.`,
      payload: summarizeRepositoryForDisplay(graph)
    });
  } catch (error) {
    setLoadError(error instanceof Error ? error.message : "Graph file could not be loaded.");
  } finally {
    event.target.value = "";
  }
}

createRoot(document.getElementById("root")!).render(<App />);
