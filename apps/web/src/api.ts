import type { RepoGraph } from "@repograph/shared-types";
import type { ActionId, ActionResult } from "./types";

export async function runRepoAction(action: ActionId, options: { query: string; changedFiles: string }): Promise<ActionResult> {
  const response = await fetch(action === "analyze" ? "/api/analyze" : "/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      query: options.query,
      changed: options.changedFiles
    })
  });
  const result = await response.json() as ActionResult | { error?: string };

  if (!response.ok || "error" in result) {
    throw new Error("error" in result && result.error ? result.error : "Action failed.");
  }

  return result as ActionResult;
}

export function formatPayload(payload: unknown) {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

export async function fetchCurrentRoot(): Promise<string> {
  const response = await fetch("/api/root");
  const data = await response.json() as { root: string };
  return data.root;
}

export async function setProjectRoot(root: string): Promise<{ root: string; message: string; graph?: RepoGraph; analyzeError?: string }> {
  const response = await fetch("/api/set-root", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root })
  });
  const result = await response.json() as { root?: string; message?: string; error?: string; graph?: RepoGraph; analyzeError?: string };
  if (!response.ok || "error" in result) {
    throw new Error(result.error ?? "Failed to set project root.");
  }
  return result as { root: string; message: string; graph?: RepoGraph; analyzeError?: string };
}

export async function fetchCurrentGraph(): Promise<RepoGraph | null> {
  const response = await fetch("/api/graph");
  if (!response.ok) {
    return null;
  }
  const data = await response.json() as { graph?: RepoGraph };
  return data.graph ?? null;
}

export function findGraphNode(graph: RepoGraph, id: string) {
  return graph.nodes.find((node) => node.id === id) ?? null;
}
