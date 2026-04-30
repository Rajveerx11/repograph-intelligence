use anyhow::Result;
use repograph_shared_types::{DependencyScope, EdgeKind, Graph, GraphEdge, GraphNode, Language, NodeKind};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::Path;

pub trait GraphStore {
    fn save_graph(&mut self, graph: &Graph) -> Result<()>;
    fn load_graph(&self) -> Result<Graph>;
    fn outgoing_edges(&self, node_id: &str) -> Result<Vec<GraphEdge>>;
    fn incoming_edges(&self, node_id: &str) -> Result<Vec<GraphEdge>>;
}

pub struct SqliteGraphStore {
    connection: Connection,
}

impl SqliteGraphStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS graph_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nodes (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              label TEXT NOT NULL,
              path TEXT,
              language TEXT,
              metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS edges (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              from_id TEXT NOT NULL,
              to_id TEXT NOT NULL,
              scope TEXT,
              metadata TEXT NOT NULL,
              FOREIGN KEY(from_id) REFERENCES nodes(id) ON DELETE CASCADE,
              FOREIGN KEY(to_id) REFERENCES nodes(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
            CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
            ",
        )?;
        Ok(())
    }
}

impl GraphStore for SqliteGraphStore {
    fn save_graph(&mut self, graph: &Graph) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM edges", [])?;
        tx.execute("DELETE FROM nodes", [])?;
        tx.execute("DELETE FROM graph_meta", [])?;
        tx.execute(
            "INSERT INTO graph_meta(key, value) VALUES('version', ?1), ('generated_at', ?2), ('root', ?3)",
            params![graph.version.to_string(), graph.generated_at, graph.root],
        )?;

        for node in &graph.nodes {
            tx.execute(
                "INSERT INTO nodes(id, kind, label, path, language, metadata) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    node.id,
                    node_kind_to_str(&node.kind),
                    node.label,
                    node.path,
                    node.language.map(language_to_str),
                    serde_json::to_string(&node.metadata)?,
                ],
            )?;
        }

        for edge in &graph.edges {
            tx.execute(
                "INSERT INTO edges(id, kind, from_id, to_id, scope, metadata) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    edge.id,
                    edge_kind_to_str(&edge.kind),
                    edge.from,
                    edge.to,
                    edge.scope.map(scope_to_str),
                    serde_json::to_string(&edge.metadata)?,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    fn load_graph(&self) -> Result<Graph> {
        let version = meta_value(&self.connection, "version")?.parse()?;
        let generated_at = meta_value(&self.connection, "generated_at")?;
        let root = meta_value(&self.connection, "root")?;
        let mut nodes_statement = self.connection.prepare(
            "SELECT id, kind, label, path, language, metadata FROM nodes ORDER BY id",
        )?;
        let nodes = nodes_statement
            .query_map([], row_to_node)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut edges_statement = self.connection.prepare(
            "SELECT id, kind, from_id, to_id, scope, metadata FROM edges ORDER BY id",
        )?;
        let edges = edges_statement
            .query_map([], row_to_edge)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(Graph {
            version,
            generated_at,
            root,
            nodes,
            edges,
        })
    }

    fn outgoing_edges(&self, node_id: &str) -> Result<Vec<GraphEdge>> {
        let mut statement = self.connection.prepare(
            "SELECT id, kind, from_id, to_id, scope, metadata FROM edges WHERE from_id = ?1 ORDER BY id",
        )?;
        Ok(statement
            .query_map(params![node_id], row_to_edge)?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn incoming_edges(&self, node_id: &str) -> Result<Vec<GraphEdge>> {
        let mut statement = self.connection.prepare(
            "SELECT id, kind, from_id, to_id, scope, metadata FROM edges WHERE to_id = ?1 ORDER BY id",
        )?;
        Ok(statement
            .query_map(params![node_id], row_to_edge)?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

fn meta_value(connection: &Connection, key: &str) -> Result<String> {
    Ok(connection.query_row("SELECT value FROM graph_meta WHERE key = ?1", params![key], |row| {
        row.get(0)
    })?)
}

fn row_to_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<GraphNode> {
    let kind: String = row.get(1)?;
    let language: Option<String> = row.get(4)?;
    let metadata: String = row.get(5)?;
    Ok(GraphNode {
        id: row.get(0)?,
        kind: str_to_node_kind(&kind),
        label: row.get(2)?,
        path: row.get(3)?,
        language: language.as_deref().map(str_to_language),
        metadata: serde_json::from_str(&metadata).unwrap_or_else(|_| json!({})),
    })
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<GraphEdge> {
    let kind: String = row.get(1)?;
    let scope: Option<String> = row.get(4)?;
    let metadata: String = row.get(5)?;
    Ok(GraphEdge {
        id: row.get(0)?,
        kind: str_to_edge_kind(&kind),
        from: row.get(2)?,
        to: row.get(3)?,
        scope: scope.as_deref().map(str_to_scope),
        metadata: serde_json::from_str::<Value>(&metadata).unwrap_or_else(|_| json!({})),
    })
}

fn node_kind_to_str(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::File => "file",
        NodeKind::Function => "function",
        NodeKind::Class => "class",
        NodeKind::Method => "method",
        NodeKind::Interface => "interface",
        NodeKind::Module => "module",
        NodeKind::Package => "package",
    }
}

fn str_to_node_kind(value: &str) -> NodeKind {
    match value {
        "function" => NodeKind::Function,
        "class" => NodeKind::Class,
        "method" => NodeKind::Method,
        "interface" => NodeKind::Interface,
        "module" => NodeKind::Module,
        "package" => NodeKind::Package,
        _ => NodeKind::File,
    }
}

fn edge_kind_to_str(kind: &EdgeKind) -> &'static str {
    match kind {
        EdgeKind::Contains => "contains",
        EdgeKind::Imports => "imports",
        EdgeKind::Exports => "exports",
        EdgeKind::References => "references",
        EdgeKind::Dependency => "dependency",
    }
}

fn str_to_edge_kind(value: &str) -> EdgeKind {
    match value {
        "imports" => EdgeKind::Imports,
        "exports" => EdgeKind::Exports,
        "references" => EdgeKind::References,
        "dependency" => EdgeKind::Dependency,
        _ => EdgeKind::Contains,
    }
}

fn language_to_str(language: Language) -> &'static str {
    match language {
        Language::JavaScript => "javascript",
        Language::TypeScript => "typescript",
        Language::Python => "python",
    }
}

fn str_to_language(value: &str) -> Language {
    match value {
        "typescript" => Language::TypeScript,
        "python" => Language::Python,
        _ => Language::JavaScript,
    }
}

fn scope_to_str(scope: DependencyScope) -> &'static str {
    match scope {
        DependencyScope::Internal => "internal",
        DependencyScope::External => "external",
    }
}

fn str_to_scope(value: &str) -> DependencyScope {
    match value {
        "external" => DependencyScope::External,
        _ => DependencyScope::Internal,
    }
}

