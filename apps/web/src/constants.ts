import type { RepoGraph } from "@repograph/shared-types";

export const MAX_GRAPH_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_RENDERED_NODES = 5000;
export const MAX_RENDERED_EDGES = 10000;

export const NODE_TYPES = ["file", "function", "class", "method", "interface", "module", "package"] as const;
export const EDGE_TYPES = ["contains", "imports", "exports", "references", "dependency"] as const;

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "packages", label: "Packages" }
] as const;

export const ACTIONS = [
  { id: "analyze", label: "Analyze repo", tone: "primary" },
  { id: "explain", label: "Explain architecture", tone: "default" },
  { id: "context", label: "Generate AI context", tone: "default" },
  { id: "agent-context", label: "Agent context", tone: "default" },
  { id: "risk", label: "Rank risk", tone: "default" },
  { id: "security", label: "Security scan", tone: "default" },
  { id: "recommend", label: "Recommendations", tone: "default" },
  { id: "supply-chain", label: "Supply chain audit", tone: "default" }
] as const;

export const SAMPLE_GRAPH: RepoGraph = {
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
