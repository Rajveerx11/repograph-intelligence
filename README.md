# RepoGraph Intelligence

RepoGraph Intelligence is an AI-native structural intelligence engine for software repositories.

It helps developers and AI systems understand how large codebases behave by converting repositories into live semantic graphs that can be analyzed, queried, visualized, and reasoned about.

## Core Idea

Most AI coding tools understand files, chunks, prompts, and embeddings. RepoGraph Intelligence focuses on structural intelligence: system-level reasoning about dependencies, architecture, coupling, impact, and repository behavior.

## Initial MVP Priorities

1. Repository parser
2. AST extraction
3. Dependency graph generation
4. Graph database layer
5. Visualization UI
6. CLI

## Planned Stack

- Frontend: React, TypeScript, TailwindCSS, Zustand, React Flow
- Desktop: Tauri
- Core engine: Rust
- Storage: SQLite, DuckDB
- Parsing: Tree-sitter
- Search: Tantivy
- AI: local and cloud-compatible model providers

## Current Implementation

The repository currently includes a dependency-light Node.js implementation of the first Phase 1 slice:

- recursive repository scanning
- JavaScript, TypeScript, and Python file detection
- import and symbol extraction
- normalized structural graph generation
- graph persistence to `.repograph/graph.json`
- repository metrics for dependency density, cycles, hotspots, coupling, and orphan files
- local semantic search
- architecture inference summaries
- compressed AI-ready repository context
- CLI commands matching the PRD shape

Rust remains the preferred long-term core engine, but the current Node.js implementation gives the project a runnable baseline while the architecture stabilizes.

## CLI

```bash
npm run repograph -- analyze ./repo
npm run repograph -- graph ./repo
npm run repograph -- stats ./repo
npm run repograph -- search ./repo "authentication flow"
npm run repograph -- explain ./repo
npm run repograph -- context ./repo
```

Analyze this repository:

```bash
npm run repograph -- analyze .
```

Search this repository:

```bash
npm run repograph -- search . "repository graph metrics"
```

Generate compressed AI context:

```bash
npm run repograph -- context . --out .repograph/context.md
```

Run checks:

```bash
npm run check
npm test
```

## Documentation

- [Product Requirements Document](docs/PRD.md)
