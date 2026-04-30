export type RepoGraphLanguage = "javascript" | "typescript" | "python";

export type RepoGraphNodeType =
  | "file"
  | "function"
  | "class"
  | "method"
  | "interface"
  | "module"
  | "package";

export type RepoGraphEdgeType =
  | "contains"
  | "imports"
  | "exports"
  | "references"
  | "dependency";

export interface RepoGraphNode {
  id: string;
  type: RepoGraphNodeType;
  label: string;
  path?: string;
  language?: RepoGraphLanguage;
  lineCount?: number;
  semanticText?: string;
  symbolCount?: number;
  importCount?: number;
  exportCount?: number;
  referenceCount?: number;
}

export interface RepoGraphEdge {
  id: string;
  type: RepoGraphEdgeType;
  from: string;
  to: string;
  scope?: "internal" | "external";
  specifier?: string;
  exportedName?: string;
}

export interface RepoGraph {
  version: number;
  generatedAt: string;
  root: string;
  nodes: RepoGraphNode[];
  edges: RepoGraphEdge[];
}

