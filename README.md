# RepoGraph Intelligence

RepoGraph Intelligence is an AI-native structural intelligence engine for software repositories.

It analyzes a codebase as a dependency graph, enriches that graph with semantic signals, and exposes repository intelligence through a CLI and MCP server that can answer questions about structure, search, architecture, and change impact.

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
- Produces structured AI agent context snapshots
- Emits structural guidance warnings for risky files and boundaries
- Runs as a local MCP stdio server for AI assistants
- Summarizes multiple repositories as a workspace
- Analyzes historical repository evolution from Git
- Infers file and module ownership from contribution history
- Identifies security-sensitive architecture risk and critical blast zones
- Generates architecture recommendations for decoupling, stabilization, and boundary cleanup

## Phase Coverage

| PRD phase | Status | Current capability |
| --- | --- | --- |
| Phase 1: Repository Structural Engine | In progress | Parser, graph generation, metrics, JSON persistence, CLI |
| Phase 2: Semantic Intelligence Layer | In progress | Local semantic search, architecture summaries, context compression |
| Phase 3: Change Impact Intelligence | In progress | Blast radius, dependency risk, refactor simulation, Git diff analysis |
| Phase 4: AI Agent and IDE Ecosystem | In progress | MCP stdio server, agent context API, guidance warnings, multi-repo summaries |
| Phase 5: Enterprise and Advanced Intelligence | In progress | History, ownership, security architecture risk, recommendations |

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

Print structural guidance warnings:

```bash
npm run repograph -- guide ./repo --changed src/auth/session.ts
```

Generate structured agent context as JSON:

```bash
npm run repograph -- agent-context ./repo --query "authentication flow" --changed src/auth/session.ts
```

Analyze multiple repositories together:

```bash
npm run repograph -- workspace ./service-a ./service-b --json
```

Analyze historical churn and drift:

```bash
npm run repograph -- history ./repo --limit 200
```

Infer file and module ownership:

```bash
npm run repograph -- ownership ./repo
```

Identify security-sensitive architecture risk:

```bash
npm run repograph -- security ./repo --json
```

Generate architecture recommendations:

```bash
npm run repograph -- recommend ./repo --limit 20
```

Start the MCP server:

```bash
npm run mcp
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
- Agent context packages summaries, search hits, impact, guidance, and compressed context for AI tools
- Guidance warnings highlight high-risk graph nodes, cycles, boundary pressure, and large blast radius
- History analysis uses Git churn, commit frequency, contributors, and monthly trends to identify evolution pressure
- Ownership intelligence maps files and modules to likely maintainers from contribution history
- Security intelligence highlights sensitive paths, wide external dependency surfaces, cycles, and critical blast zones
- Recommendation generation turns structural signals into prioritized architecture actions

## AI and IDE Integration

RepoGraph includes an MCP-compatible stdio server intended for local AI assistants, coding agents, and future IDE integrations.

Start it with:

```bash
npm run mcp
```

The server exposes these tools:

| Tool | Purpose |
| --- | --- |
| `repograph_analyze` | Return repository metrics, architecture, and package summary |
| `repograph_search` | Search files by local semantic relevance |
| `repograph_context` | Return AI-ready context with summaries, matches, guidance, and impact |
| `repograph_impact` | Estimate blast radius for changed files |
| `repograph_guidance` | Return structural warnings and recommendations |
| `repograph_history` | Analyze repository evolution from Git history |
| `repograph_ownership` | Infer file and module ownership |
| `repograph_security` | Identify security-sensitive architecture risk |
| `repograph_recommend` | Generate architecture improvement recommendations |

The MCP server is intentionally local-first. It analyzes source on demand and does not require cloud services or model provider credentials.

## Project Layout

```text
packages/
  cli/
    src/index.js            CLI entrypoint
  mcp/
    src/server.js           MCP stdio server
  core/
    src/
      agent.js              AI context and guidance APIs
      architecture.js       Architecture inference
      graph.js              Normalized graph builder
      history.js            Historical churn and evolution analysis
      impact.js             Phase 3 impact intelligence
      metrics.js            Repository metrics
      ownership.js          Ownership inference from history
      recommendations.js    Architecture recommendations
      repository.js         Repository analysis orchestration
      scanner.js            Recursive source scanner
      semantic.js           Local semantic index/search
      security.js           Security architecture risk analysis
      storage.js            Graph persistence
      summaries.js          Repository summaries and context compression
      workspace.js          Multi-repository workspace summaries
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
- Expand MCP tools for symbol-level references and saved graph resources
- Improve historical drift scoring and ownership confidence
- Add dependency manifest parsing for package-version security context

Longer-term priorities:

- Rust core engine
- Incremental repository indexing
- Deeper multi-repository service intelligence

## Design Principles

- The graph is infrastructure, not the product.
- Repository intelligence should be explainable and inspectable.
- Local analysis should work before cloud or model-backed features are required.
- AI context should be grounded in structural facts, not only embeddings.
- Every feature should help developers understand risk, architecture, or change impact.

## Contributing

Contributions are welcome, especially around parser support, graph algorithms, architecture rules, CLI ergonomics, MCP integrations, and test fixtures.

Before opening a pull request:

```bash
npm run check
npm test
```

For larger changes, please include a short explanation of the repository behavior being modeled and the tradeoffs in the implementation. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

## License

MIT. See [LICENSE.md](LICENSE.md).
