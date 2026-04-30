# Rust Phase 1 Core

RepoGraph now includes a Rust workspace that mirrors the production architecture target while the existing Node.js CLI remains the verified baseline in this repository.

## Workspace Layout

```text
/apps
  /cli              Rust CLI entrypoint for analyze, graph, and stats
  /web              React Flow graph explorer

/crates
  /shared_types     Versioned graph, parser, edge, node, and metric contracts
  /parser_engine    Repository scanning and Tree-sitter-backed parsing
  /graph_engine     Directed typed graph construction and repository metrics
  /storage_engine   SQLite graph store and traversal primitives

/packages
  /shared-types     TypeScript graph contracts for frontend and integrations
```

## Phase 1 Coverage

- Repository scanning is bounded by max file size, max file count, max depth, and ignored directories.
- TypeScript, JavaScript, and Python source files are parsed through Tree-sitter before extraction.
- Extracted facts include files, imports, exports, symbols, methods, interfaces, and references.
- The graph model uses typed nodes, typed edges, metadata, internal dependency edges, and external package dependency edges.
- SQLite storage persists nodes and edges in indexed tables behind a `GraphStore` abstraction.
- The Rust CLI supports:

```bash
cargo run -p repograph -- analyze ./repo
cargo run -p repograph -- graph ./repo
cargo run -p repograph -- stats ./repo
```

## Verification Note

The current development machine used for this pass does not have `cargo` or `rustc` installed, so Rust compilation could not be executed locally. The Node baseline and web workspace were verified with:

```bash
npm test
npm run check
npm run web:build
npm audit --json
```

