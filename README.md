# RepoGraph Intelligence

RepoGraph Intelligence is an AI-native structural intelligence engine for software repositories.

It analyzes a codebase as a dependency graph, enriches that graph with semantic signals, and exposes repository intelligence through a CLI and MCP server that can answer questions about structure, search, architecture, and change impact.

The goal is not to be another autocomplete tool or chat wrapper. RepoGraph focuses on the missing layer underneath AI-assisted development: durable structural context about how a repository is connected and what a change is likely to affect.

## Status

This project is in active early development.

The repository now contains two implementation tracks:

- A verified Node.js baseline that powers the current CLI, MCP server, intelligence APIs, and tests.
- A Rust Phase 1 core workspace that introduces the production architecture target: Tree-sitter parsing, typed graph construction, SQLite storage, and a modular CLI.

The Node implementation remains the stable runtime surface while the Rust core matures behind the same product contracts.

## What It Does Today

- Recursively scans JavaScript, TypeScript, and Python repositories
- Extracts imports, exports, functions, classes, interfaces, default exports, and Python definitions through a comment- and string-aware source masker that suppresses false positives inside strings, regex, template-literal text, and JSDoc blocks
- Builds a normalized file, symbol, package, and dependency graph
- Calculates structural metrics such as density, cycles, hotspots, coupling, and orphan files
- Performs local semantic search over paths, symbols, imports, comments, and identifiers
- Infers modules, layers, architecture boundaries, and structural risk signals
- Generates compressed AI-ready repository context
- Estimates blast radius for changed files
- Scores dependency risk across the repository
- Simulates refactor/change-set impact
- Analyzes changed files from a Git diff with hardened ref validation that rejects refs starting with `-`, whitespace, or control characters and terminates option parsing with `--`
- Produces structured AI agent context snapshots
- Emits structural guidance warnings for risky files and boundaries
- Runs as a local MCP stdio server for AI assistants
- Summarizes multiple repositories as a workspace
- Analyzes historical repository evolution from Git
- Infers file and module ownership from contribution history
- Identifies security-sensitive architecture risk and critical blast zones
- Generates architecture recommendations for decoupling, stabilization, and boundary cleanup
- Audits dependency manifests across npm, Cargo, `requirements.txt`, and `pyproject.toml` with license classification (permissive, copyleft, proprietary) and optional OSV.dev advisory lookups
- Validates graph schema integrity and missing references
- Creates stable graph snapshots for baselines and CI
- Compares snapshots to detect structural drift
- Produces CI-oriented structural intelligence reports
- Watches a repository in the background and rebuilds the graph incrementally on file changes with a debounced collapse window
- Provides a React Flow graph explorer with a live indicator that streams graph updates over Server-Sent Events as the watcher rebuilds
- Hardens the local web server against CORS bypass and DNS rebinding via Host allowlist, `Sec-Fetch-Site` enforcement, and Origin/Referer validation
- Includes a Rust Phase 1 core workspace for parser, graph, storage, metrics, and CLI foundations

## Phase Coverage

| PRD phase | Status | Current capability |
| --- | --- | --- |
| Phase 1: Repository Structural Engine | In progress | Parser, graph generation, metrics, JSON/SQLite persistence, CLI, React Flow explorer, Rust core scaffold |
| Phase 2: Semantic Intelligence Layer | In progress | Local semantic search, architecture summaries, context compression |
| Phase 3: Change Impact Intelligence | In progress | Blast radius, dependency risk, refactor simulation, Git diff analysis |
| Phase 4: AI Agent and IDE Ecosystem | In progress | MCP stdio server, agent context API, guidance warnings, multi-repo summaries |
| Phase 5: Enterprise and Advanced Intelligence | In progress | History, ownership, security architecture risk, supply-chain audit with OSV advisories, recommendations |
| Phase 6: Operationalization and CI Readiness | In progress | Graph validation, snapshots, baseline comparison, live watch with SSE, CI reports |

## Quick Start

Requirements:

- Node.js 20 or newer
- npm
- Git
- Rust toolchain for the new Rust core workspace (`cargo`, `rustc`)

Clone and run:

```bash
git clone https://github.com/Rajveerx11/repograph-intelligence.git
cd repograph-intelligence
npm test
```

Build the graph explorer UI:

```bash
npm run web:build
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

Validate graph integrity:

```bash
npm run repograph -- validate ./repo
```

Create a stable graph snapshot:

```bash
npm run repograph -- snapshot ./repo --out .repograph/snapshot.json
```

Compare two graph snapshots:

```bash
npm run repograph -- compare --base baseline.json --head current.json
```

Generate a CI report:

```bash
npm run repograph -- ci ./repo --baseline .repograph/snapshot.json --fail-on high --out .repograph/ci-report.json
```

Audit dependency manifests, licenses, and (optionally) OSV advisories:

```bash
npm run repograph -- supply-chain ./repo
npm run repograph -- supply-chain ./repo --online --json --out .repograph/supply-chain.json
```

The `--online` flag queries the public OSV.dev `v1/querybatch` endpoint for known vulnerabilities. Without it the audit stays fully offline and only reports license risk and unpinned versions.

Watch a repository and rebuild the graph on every file change:

```bash
npm run repograph -- watch ./repo --debounce 250 --out .repograph/graph.json
```

The watcher collapses bursts of file changes inside a debounce window, emits structured events for tooling, and writes the latest graph back to disk. Press `Ctrl+C` to stop.

Start the MCP server:

```bash
npm run mcp
```

Run the Rust Phase 1 core when a Rust toolchain is installed:

```bash
cargo run -p repograph -- analyze ./repo
cargo run -p repograph -- stats ./repo
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
- Supply-chain auditing parses dependency manifests, classifies licenses, flags unpinned versions, and (optionally) cross-checks OSV.dev for advisories
- Live watch mode rebuilds the graph incrementally on file changes and pushes updates to the explorer over Server-Sent Events
- Graph validation checks schema integrity, duplicate ids, duplicate paths, and missing edge endpoints
- Snapshots create stable fingerprints for baseline comparison
- CI reports combine validation, security findings, recommendations, and baseline drift into pass/fail output

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
| `repograph_supply_chain` | Audit dependency manifests, license risk, and optional OSV advisories |
| `repograph_recommend` | Generate architecture improvement recommendations |
| `repograph_validate` | Validate graph schema and references |
| `repograph_snapshot` | Create a stable graph intelligence snapshot |
| `repograph_compare` | Compare two graph snapshots |
| `repograph_ci` | Produce a CI-oriented structural intelligence report |

The MCP server is intentionally local-first. It analyzes source on demand and does not require cloud services or model provider credentials.

## Project Layout

```text
apps/
  cli/
    src/main.rs             Rust Phase 1 CLI entrypoint
  web/
    src/main.tsx            React Flow graph explorer
crates/
  shared_types/             Rust graph, parser, node, edge, and metric contracts
  parser_engine/            Tree-sitter-backed repository parser
  graph_engine/             Directed graph construction and structural metrics
  storage_engine/           SQLite graph store abstraction
packages/
  shared-types/
    src/index.ts            TypeScript graph contracts for UI/integrations
  cli/
    src/index.js            CLI entrypoint
  mcp/
    src/server.js           MCP stdio server
  core/
    src/
      agent.js              AI context and guidance APIs
      architecture.js       Architecture inference
      extractors/
        javascript.js       JS/TS symbol, import, export, reference extraction
        python.js           Python module and definition extraction
        source-masker.js    Comment- and string-aware source masker for accurate extraction
      graph.js              Normalized graph builder
      history.js            Historical churn and evolution analysis
      impact.js             Phase 3 impact intelligence
      metrics.js            Repository metrics
      ownership.js          Ownership inference from history
      operations.js         Validation, snapshots, comparison, CI reports
      recommendations.js    Architecture recommendations
      repository.js         Repository analysis orchestration with atomic file reads
      scanner.js            Recursive source scanner
      semantic.js           Local semantic index/search
      security.js           Security architecture risk analysis
      storage.js            Graph persistence
      summaries.js          Repository summaries and context compression
      supply-chain.js       Manifest parsing, license classification, OSV advisory lookups
      watch.js              Recursive watcher with debounced incremental graph rebuilds
      workspace.js          Multi-repository workspace summaries
test/
  core.test.js              Core behavior tests
  features.test.js          Tests for the source masker, supply-chain audit, and watch lifecycle
  fixtures/                 Small multi-language fixture repository
docs/
  PRD.md                    Product requirements document
  GRAPH_SCHEMA.md           Current graph and snapshot schema notes
  RUST_CORE.md              Rust Phase 1 architecture and verification notes
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

Run dependency audit:

```bash
npm run audit
```

Build the graph explorer:

```bash
npm run web:build
```

Run the CLI locally:

```bash
npm run repograph -- help
```

When a Rust toolchain is installed, validate the Rust core with:

```bash
cargo test --workspace
```

The verified Node runtime intentionally stays small and inspectable while the Rust graph engine matures into the production core.

## Roadmap

Near-term priorities:

- Add richer symbol-level references and call edges
- Expand MCP tools for symbol-level references and saved graph resources
- Compile and harden the Rust core in CI once Rust tooling is available in the build environment
- Improve historical drift scoring and ownership confidence
- Cache OSV advisory responses on disk so repeated supply-chain audits stay quick offline
- Move JS/TS extraction onto a real AST (acorn or tree-sitter) once the regex-plus-masker pipeline saturates

Longer-term priorities:

- True incremental indexing where the watcher mutates the graph in place instead of rebuilding from scratch
- Deeper multi-repository service intelligence
- Tauri desktop packaging around the web explorer and Rust core

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

MIT. See [LICENSE](LICENSE).
