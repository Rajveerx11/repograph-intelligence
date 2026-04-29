# RepoGraph Intelligence

RepoGraph Intelligence is an AI-native structural intelligence engine for software repositories.

It analyzes a codebase as a dependency graph, enriches that graph with semantic signals, and exposes repository intelligence through a CLI that can answer questions about structure, search, architecture, and change impact.

The goal is not to be another autocomplete tool or chat wrapper. RepoGraph focuses on the missing layer underneath AI-assisted development: durable structural context about how a repository is connected and what a change is likely to affect.

## Status

This project is in active early development.

The current implementation is a dependency-light Node.js baseline that validates the product model and CLI contracts. The long-term core engine is expected to move toward Rust, Tree-sitter, SQLite/DuckDB, and a richer graph storage layer as the system matures.

## What It Does Today

- Recursively scans JavaScript, TypeScript, and Python repositories
- Extracts imports, exports, functions, classes, interfaces, and Python definitions
- Builds a normalized file, symbol, package, and dependency graph
- Calculates structural metrics such as density, cycles, hotspots, coupling, and orphan files
- Performs local semantic search over paths, symbols, imports, comments, and identifiers
- Infers modules, layers, architecture boundaries, and structural risk signals
- Generates compressed AI-ready repository context
- Estimates blast radius for changed files
- Scores dependency risk across the repository
- Simulates refactor/change-set impact
- Analyzes changed files from a Git diff

## Phase Coverage

| PRD phase | Status | Current capability |
| --- | --- | --- |
| Phase 1: Repository Structural Engine | In progress | Parser, graph generation, metrics, JSON persistence, CLI |
| Phase 2: Semantic Intelligence Layer | In progress | Local semantic search, architecture summaries, context compression |
| Phase 3: Change Impact Intelligence | In progress | Blast radius, dependency risk, refactor simulation, Git diff analysis |
| Phase 4: AI Agent and IDE Ecosystem | Planned | MCP server, IDE integrations, context APIs |
| Phase 5: Enterprise and Advanced Intelligence | Planned | History, ownership, security, recommendations |

## Quick Start

Requirements:

- Node.js 20 or newer
- npm
- Git

Clone and run:

```bash
git clone https://github.com/Rajveerx11/repograph-intelligence.git
cd repograph-intelligence
npm test
```

Analyze the current repository:

```bash
npm run repograph -- analyze .
```

This writes the normalized graph to:

```text
.repograph/graph.json
```

## CLI Usage

Analyze a repository and persist the graph:

```bash
npm run repograph -- analyze ./repo
```

Print repository metrics:

```bash
npm run repograph -- stats ./repo
```

Search semantically across files:

```bash
npm run repograph -- search ./repo "authentication flow"
```

Explain inferred architecture:

```bash
npm run repograph -- explain ./repo
```

Generate compressed AI context:

```bash
npm run repograph -- context ./repo --out .repograph/context.md
```

Estimate blast radius for a changed file:

```bash
npm run repograph -- impact ./repo src/auth/session.ts
```

Rank dependency risk:

```bash
npm run repograph -- risk ./repo --limit 20
```

Simulate a refactor or change set:

```bash
npm run repograph -- simulate ./repo src/auth/session.ts src/auth/user.ts
```

Analyze changed files from a Git diff:

```bash
npm run repograph -- diff ./repo --base origin/main --head HEAD
```

Every intelligence command supports JSON output where useful:

```bash
npm run repograph -- impact ./repo src/auth/session.ts --json
```

## Core Concepts

RepoGraph represents a repository as a graph:

- File nodes represent source files
- Symbol nodes represent functions, classes, interfaces, and definitions
- Package nodes represent external dependencies
- Edges represent containment, imports, and dependency relationships

On top of that graph, RepoGraph derives intelligence:

- Structural metrics identify coupling and graph shape
- Semantic search maps natural-language queries to relevant files
- Architecture inference groups files into modules, layers, and boundaries
- Impact analysis walks reverse dependency paths to estimate downstream blast radius
- Risk scoring ranks files by fan-in, fan-out, external dependencies, symbols, and cycles

## Project Layout

```text
packages/
  cli/
    src/index.js            CLI entrypoint
  core/
    src/
      architecture.js       Architecture inference
      graph.js              Normalized graph builder
      impact.js             Phase 3 impact intelligence
      metrics.js            Repository metrics
      repository.js         Repository analysis orchestration
      scanner.js            Recursive source scanner
      semantic.js           Local semantic index/search
      storage.js            Graph persistence
      summaries.js          Repository summaries and context compression
test/
  core.test.js              Core behavior tests
  fixtures/                 Small multi-language fixture repository
docs/
  PRD.md                    Product requirements document
```

## Development

Run syntax checks:

```bash
npm run check
```

Run tests:

```bash
npm test
```

Run the CLI locally:

```bash
npm run repograph -- help
```

The project intentionally avoids heavy runtime dependencies at this stage. That keeps the architecture easy to inspect while the graph model, CLI behavior, and intelligence APIs stabilize.

## Roadmap

Near-term priorities:

- Replace regex-based extraction with Tree-sitter parsers
- Add stable graph schema documentation
- Persist graph indexes in SQLite
- Add richer symbol-level references and call edges
- Add PR-oriented output formats for CI
- Add visualization using React Flow
- Add MCP server support for AI assistants and coding agents

Longer-term priorities:

- Rust core engine
- Incremental repository indexing
- Historical architecture drift analysis
- Ownership and team intelligence
- Security and dependency path risk analysis
- Multi-repository intelligence

## Design Principles

- The graph is infrastructure, not the product.
- Repository intelligence should be explainable and inspectable.
- Local analysis should work before cloud or model-backed features are required.
- AI context should be grounded in structural facts, not only embeddings.
- Every feature should help developers understand risk, architecture, or change impact.

## Contributing

Contributions are welcome, especially around parser support, graph algorithms, architecture rules, CLI ergonomics, and test fixtures.

Before opening a pull request:

```bash
npm run check
npm test
```

For larger changes, please include a short explanation of the repository behavior being modeled and the tradeoffs in the implementation.

## License

MIT

