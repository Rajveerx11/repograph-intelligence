use repograph_shared_types::{
    DependencyScope, EdgeKind, FileHotspot, Graph, GraphEdge, GraphNode, Language, NodeKind,
    RepositoryMetrics, SourceFile,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const JS_EXTENSIONS: [&str; 6] = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

pub fn build_graph(root: impl AsRef<Path>, files: &[SourceFile]) -> Graph {
    let root = root.as_ref().display().to_string();
    let mut graph = Graph {
        version: 1,
        generated_at: unix_timestamp_string(),
        root,
        nodes: Vec::new(),
        edges: Vec::new(),
    };
    let file_by_path: HashMap<_, _> = files
        .iter()
        .map(|file| (file.relative_path.clone(), file))
        .collect();
    let mut package_nodes = HashSet::new();

    for file in files {
        graph.nodes.push(GraphNode {
            id: file_node_id(&file.relative_path),
            kind: NodeKind::File,
            label: basename(&file.relative_path),
            path: Some(file.relative_path.clone()),
            language: Some(file.language),
            metadata: json!({
                "lineCount": file.line_count,
                "symbolCount": file.symbols.len(),
                "imports": file.imports.len(),
                "exports": file.exports.len(),
                "references": file.references.len()
            }),
        });

        for symbol in &file.symbols {
            let symbol_id = symbol_node_id(&file.relative_path, &symbol.name);
            graph.nodes.push(GraphNode {
                id: symbol_id.clone(),
                kind: symbol.kind.clone(),
                label: symbol.name.clone(),
                path: Some(file.relative_path.clone()),
                language: Some(file.language),
                metadata: json!({ "line": symbol.line, "column": symbol.column }),
            });
            graph.edges.push(GraphEdge {
                id: edge_id(EdgeKind::Contains, &file_node_id(&file.relative_path), &symbol_id, ""),
                kind: EdgeKind::Contains,
                from: file_node_id(&file.relative_path),
                to: symbol_id,
                scope: None,
                metadata: json!({}),
            });
        }
    }

    for file in files {
        let from = file_node_id(&file.relative_path);

        for import in &file.imports {
            if let Some(target_path) = resolve_import(file, &import.specifier, &file_by_path) {
                graph.edges.push(GraphEdge {
                    id: edge_id(
                        EdgeKind::Imports,
                        &from,
                        &file_node_id(&target_path),
                        &import.specifier,
                    ),
                    kind: EdgeKind::Imports,
                    from: from.clone(),
                    to: file_node_id(&target_path),
                    scope: Some(DependencyScope::Internal),
                    metadata: json!({
                        "specifier": &import.specifier,
                        "line": import.line,
                        "importedNames": &import.imported_names
                    }),
                });
            } else {
                let package = package_name(&import.specifier);
                let package_id = package_node_id(&package);
                if package_nodes.insert(package_id.clone()) {
                    graph.nodes.push(GraphNode {
                        id: package_id.clone(),
                        kind: NodeKind::Package,
                        label: package.clone(),
                        path: None,
                        language: None,
                        metadata: json!({}),
                    });
                }
                graph.edges.push(GraphEdge {
                    id: edge_id(EdgeKind::Dependency, &from, &package_id, &import.specifier),
                    kind: EdgeKind::Dependency,
                    from: from.clone(),
                    to: package_id,
                    scope: Some(DependencyScope::External),
                    metadata: json!({ "specifier": &import.specifier, "line": import.line }),
                });
            }
        }

        for export in &file.exports {
            let symbol_id = symbol_node_id(&file.relative_path, &export.name);
            if graph.nodes.iter().any(|node| node.id == symbol_id) {
                graph.edges.push(GraphEdge {
                    id: edge_id(EdgeKind::Exports, &from, &symbol_id, &export.name),
                    kind: EdgeKind::Exports,
                    from: from.clone(),
                    to: symbol_id,
                    scope: None,
                    metadata: json!({ "line": export.line }),
                });
            }
        }
    }

    graph.nodes.sort_by(|left, right| left.id.cmp(&right.id));
    graph.edges.sort_by(|left, right| left.id.cmp(&right.id));
    graph
}

pub fn calculate_metrics(graph: &Graph) -> RepositoryMetrics {
    let file_nodes: Vec<_> = graph.nodes.iter().filter(|node| node.kind == NodeKind::File).collect();
    let symbol_count = graph
        .nodes
        .iter()
        .filter(|node| matches!(node.kind, NodeKind::Function | NodeKind::Class | NodeKind::Method | NodeKind::Interface))
        .count();
    let internal_edges: Vec<_> = graph
        .edges
        .iter()
        .filter(|edge| edge.scope == Some(DependencyScope::Internal))
        .collect();
    let external_dependencies = graph
        .edges
        .iter()
        .filter(|edge| edge.scope == Some(DependencyScope::External))
        .count();
    let degrees = calculate_degrees(&file_nodes, &internal_edges);
    let circular_dependencies = find_cycles(&file_nodes, &internal_edges);
    let hotspots = top_files(&file_nodes, &degrees, 10);
    let total_degree: usize = degrees.values().map(|degree| degree.total).sum();
    let coupling_score = if file_nodes.is_empty() {
        0.0
    } else {
        round2(total_degree as f64 / file_nodes.len() as f64)
    };

    RepositoryMetrics {
        files: file_nodes.len(),
        symbols: symbol_count,
        edges: graph.edges.len(),
        internal_dependencies: internal_edges.len(),
        external_dependencies,
        dependency_density: density(file_nodes.len(), internal_edges.len()),
        circular_dependencies,
        orphan_modules: file_nodes
            .iter()
            .filter(|node| degrees.get(&node.id).map(|degree| degree.total).unwrap_or(0) == 0)
            .filter_map(|node| node.path.clone())
            .collect(),
        hotspots,
        coupling_score,
    }
}

#[derive(Default)]
struct Degree {
    incoming: usize,
    outgoing: usize,
    total: usize,
}

fn calculate_degrees(file_nodes: &[&GraphNode], internal_edges: &[&GraphEdge]) -> HashMap<String, Degree> {
    let mut degrees: HashMap<_, _> = file_nodes
        .iter()
        .map(|node| (node.id.clone(), Degree::default()))
        .collect();

    for edge in internal_edges {
        if let Some(degree) = degrees.get_mut(&edge.from) {
            degree.outgoing += 1;
            degree.total += 1;
        }
        if let Some(degree) = degrees.get_mut(&edge.to) {
            degree.incoming += 1;
            degree.total += 1;
        }
    }

    degrees
}

fn top_files(file_nodes: &[&GraphNode], degrees: &HashMap<String, Degree>, limit: usize) -> Vec<FileHotspot> {
    let mut hotspots: Vec<_> = file_nodes
        .iter()
        .filter_map(|node| {
            let degree = degrees.get(&node.id)?;
            if degree.total == 0 {
                return None;
            }
            Some(FileHotspot {
                path: node.path.clone().unwrap_or_else(|| node.label.clone()),
                incoming: degree.incoming,
                outgoing: degree.outgoing,
                total_degree: degree.total,
            })
        })
        .collect();
    hotspots.sort_by(|left, right| {
        right
            .total_degree
            .cmp(&left.total_degree)
            .then_with(|| left.path.cmp(&right.path))
    });
    hotspots.truncate(limit);
    hotspots
}

fn find_cycles(file_nodes: &[&GraphNode], internal_edges: &[&GraphEdge]) -> Vec<Vec<String>> {
    let mut adjacency: HashMap<String, Vec<String>> = file_nodes
        .iter()
        .map(|node| (node.id.clone(), Vec::new()))
        .collect();
    for edge in internal_edges {
        adjacency.entry(edge.from.clone()).or_default().push(edge.to.clone());
    }

    let mut state = HashMap::new();
    let mut stack = Vec::new();
    let mut cycles = HashSet::new();

    fn visit(
        node: &str,
        adjacency: &HashMap<String, Vec<String>>,
        state: &mut HashMap<String, &'static str>,
        stack: &mut Vec<String>,
        cycles: &mut HashSet<String>,
    ) {
        state.insert(node.to_string(), "visiting");
        stack.push(node.to_string());
        for next in adjacency.get(node).into_iter().flatten() {
            match state.get(next.as_str()) {
                None => visit(next, adjacency, state, stack, cycles),
                Some(&"visiting") => {
                    if let Some(start) = stack.iter().position(|item| item == next) {
                        let cycle = stack[start..]
                            .iter()
                            .chain(std::iter::once(next))
                            .map(|item| item.trim_start_matches("file:").to_string())
                            .collect::<Vec<_>>()
                            .join(" -> ");
                        cycles.insert(cycle);
                    }
                }
                _ => {}
            }
        }
        stack.pop();
        state.insert(node.to_string(), "visited");
    }

    for node in file_nodes {
        if !state.contains_key(&node.id) {
            visit(&node.id, &adjacency, &mut state, &mut stack, &mut cycles);
        }
    }

    let mut cycles: Vec<_> = cycles
        .into_iter()
        .map(|cycle| cycle.split(" -> ").map(ToOwned::to_owned).collect())
        .collect();
    cycles.sort();
    cycles
}

fn resolve_import(
    source_file: &SourceFile,
    specifier: &str,
    file_by_path: &HashMap<String, &SourceFile>,
) -> Option<String> {
    match source_file.language {
        Language::JavaScript | Language::TypeScript => resolve_javascript_import(source_file, specifier, file_by_path),
        Language::Python => resolve_python_import(source_file, specifier, file_by_path),
    }
}

fn resolve_javascript_import(
    source_file: &SourceFile,
    specifier: &str,
    file_by_path: &HashMap<String, &SourceFile>,
) -> Option<String> {
    if !specifier.starts_with('.') {
        return None;
    }
    let base = parent_path(&source_file.relative_path);
    let candidate = normalize_posix(&format!("{base}/{specifier}"));
    first_existing(
        file_by_path,
        std::iter::once(candidate.clone())
            .chain(JS_EXTENSIONS.iter().map(|extension| format!("{candidate}{extension}")))
            .chain(JS_EXTENSIONS.iter().map(|extension| format!("{candidate}/index{extension}"))),
    )
}

fn resolve_python_import(
    source_file: &SourceFile,
    specifier: &str,
    file_by_path: &HashMap<String, &SourceFile>,
) -> Option<String> {
    let base = parent_path(&source_file.relative_path);
    if specifier.starts_with('.') {
        let dots = specifier.chars().take_while(|value| *value == '.').count();
        let module = specifier[dots..].replace('.', "/");
        let mut directory = base;
        for _ in 1..dots {
            directory = parent_path(&directory);
        }
        let candidate = normalize_posix(&format!("{directory}/{module}"));
        return first_existing(file_by_path, python_candidates(&candidate));
    }

    let absolute = specifier.replace('.', "/");
    let relative = normalize_posix(&format!("{base}/{absolute}"));
    first_existing(
        file_by_path,
        python_candidates(&relative).into_iter().chain(python_candidates(&absolute)),
    )
}

fn python_candidates(candidate: &str) -> Vec<String> {
    vec![
        candidate.to_string(),
        format!("{candidate}.py"),
        format!("{candidate}/__init__.py"),
    ]
}

fn first_existing<I>(file_by_path: &HashMap<String, &SourceFile>, candidates: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    candidates.into_iter().find(|candidate| file_by_path.contains_key(candidate))
}

fn parent_path(path: &str) -> String {
    PathBuf::from(path)
        .parent()
        .map(|path| path.display().to_string().replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn normalize_posix(value: &str) -> String {
    let mut parts = Vec::new();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn density(file_count: usize, edge_count: usize) -> f64 {
    if file_count < 2 {
        return 0.0;
    }
    round4(edge_count as f64 / (file_count * (file_count - 1)) as f64)
}

fn package_name(specifier: &str) -> String {
    if specifier.starts_with('@') {
        return specifier.split('/').take(2).collect::<Vec<_>>().join("/");
    }
    specifier.split('/').next().unwrap_or(specifier).to_string()
}

fn basename(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn file_node_id(path: &str) -> String {
    format!("file:{path}")
}

fn symbol_node_id(path: &str, name: &str) -> String {
    format!("symbol:{path}:{name}")
}

fn package_node_id(name: &str) -> String {
    format!("package:{name}")
}

fn edge_id(kind: EdgeKind, from: &str, to: &str, extra: &str) -> String {
    format!("{kind:?}:{from}->{to}:{extra}")
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use repograph_shared_types::{Import, SourceFile, Symbol};

    #[test]
    fn builds_internal_dependency_graph() {
        let files = vec![
            source("src/index.ts", vec![import("./util")], vec![symbol("main")]),
            source("src/util.ts", vec![], vec![symbol("helper")]),
        ];
        let graph = build_graph(".", &files);
        let metrics = calculate_metrics(&graph);

        assert_eq!(metrics.files, 2);
        assert_eq!(metrics.internal_dependencies, 1);
        assert!(graph.edges.iter().any(|edge| edge.from == "file:src/index.ts" && edge.to == "file:src/util.ts"));
    }

    fn source(path: &str, imports: Vec<Import>, symbols: Vec<Symbol>) -> SourceFile {
        SourceFile {
            absolute_path: path.to_string(),
            relative_path: path.to_string(),
            language: Language::TypeScript,
            line_count: 1,
            symbols,
            imports,
            exports: vec![],
            references: vec![],
        }
    }

    fn import(specifier: &str) -> Import {
        Import {
            specifier: specifier.to_string(),
            imported_names: vec![],
            line: 1,
            is_relative: true,
        }
    }

    fn symbol(name: &str) -> Symbol {
        Symbol {
            name: name.to_string(),
            kind: NodeKind::Function,
            line: 1,
            column: 1,
        }
    }
}
