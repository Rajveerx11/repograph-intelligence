use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    JavaScript,
    TypeScript,
    Python,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    File,
    Function,
    Class,
    Method,
    Interface,
    Module,
    Package,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Contains,
    Imports,
    Exports,
    References,
    Dependency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyScope {
    Internal,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceFile {
    pub absolute_path: String,
    pub relative_path: String,
    pub language: Language,
    pub line_count: usize,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<Import>,
    pub exports: Vec<Export>,
    pub references: Vec<Reference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: NodeKind,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Import {
    pub specifier: String,
    pub imported_names: Vec<String>,
    pub line: usize,
    pub is_relative: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Export {
    pub name: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reference {
    pub name: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    pub version: u32,
    pub generated_at: String,
    pub root: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    pub path: Option<String>,
    pub language: Option<Language>,
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub kind: EdgeKind,
    pub from: String,
    pub to: String,
    pub scope: Option<DependencyScope>,
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepositoryMetrics {
    pub files: usize,
    pub symbols: usize,
    pub edges: usize,
    pub internal_dependencies: usize,
    pub external_dependencies: usize,
    pub dependency_density: f64,
    pub circular_dependencies: Vec<Vec<String>>,
    pub orphan_modules: Vec<String>,
    pub hotspots: Vec<FileHotspot>,
    pub coupling_score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileHotspot {
    pub path: String,
    pub incoming: usize,
    pub outgoing: usize,
    pub total_degree: usize,
}
