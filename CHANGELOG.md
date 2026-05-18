# Changelog

All notable changes to RepoGraph Intelligence are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GitHub Action (PR bot)** — new composite action under `apps/github-action/` runs every RepoGraph PR gate and posts a sticky verdict comment on every pull request. The action installs the canonical `repograph-intelligence` CLI, analyzes the PR head once, then runs `policy`, `api-diff`, `drift`, and `test-select` against the appropriate input files (skipping any whose file is missing). The verdict comment is a single Markdown block keyed by an HTML marker so subsequent runs update the same comment instead of accumulating noise; teams can switch to per-run comments via `comment-mode: append`. Outputs `verdict` (`pass` / `fail`) and `comment-url`. The action mirrors the CLI's distinct exit codes (`2` policy, `3` api-diff, `4` drift) so downstream workflow steps can branch on which gate fired. A new `github-action` CI job lints + tests the action on every PR. The custom REST client refuses to follow redirects and refuses to follow `Link` headers that point outside `api.github.com`, so a hostile API response cannot leak the workflow token; workspace-relative inputs are validated with `path.relative` containment checks. 17 new unit tests cover the formatter contract for every gate type plus the REST client's pagination, redirect refusal, host check, and error propagation.
- **VS Code extension** — new standalone npm package under `apps/vscode/` brings RepoGraph into the editor inner loop. Spawns the canonical MCP server as a child process and speaks JSON-RPC over stdio (no embedded analyzer, no telemetry). Ships with a blast-radius CodeLens above the first top-level declaration of every JS / TS / Python file, a Risk Ranking sidebar in the activity bar that surfaces critical-blast-zone files with reasons, a status-bar refresh trigger, and four palette commands: `Analyze Workspace`, `Show Blast Radius for Active File`, `Run Architecture Policy`, `Check Drift Against Baseline`. The MCP client is hardened with an 8 MB inbound buffer cap, a 60 s per-request timeout, cooperative shutdown on `deactivate`, and handles both newline-delimited and `Content-Length`-framed transports. Five new unit tests use a Node-driven mock MCP server to verify the handshake, JSON-vs-text response routing, error propagation, and timeout behaviour. A new `vscode` job in `.github/workflows/ci.yml` installs the extension package, compiles the TypeScript, and runs the unit tests on every PR.
- **Docker image + pre-built tarball releases** — new top-level `Dockerfile` ships a slim Alpine image with a non-root `repograph` user, ENTRYPOINT pointing at the CLI, and a `/repo` workdir designed for bind-mount usage (`docker run --rm -v $(pwd):/repo ghcr.io/rajveerx11/repograph-intelligence:latest analyze /repo`). A new `docker` job in `.github/workflows/ci.yml` builds the image on every PR with build cache reused across runs and smoke-tests `help` + `stats` against the image. A new `.github/workflows/release.yml` triggers on `v*.*.*` tags, publishes versioned + `latest` tags to GHCR, and uploads a `repograph-intelligence-vX.Y.Z.tar.gz` standalone tarball (bundled production `node_modules`) as a release asset with a SHA-256 sidecar.
- **Baselines + Drift Gate** — new `detectDrift(baseInput, headInput, options)` core function wraps `compareGraphSnapshots` with a per-metric threshold matrix so CI can gate merges on bounded structural change. Default threshold is "no new cycles allowed"; every other metric (`maxAddedFiles`, `maxRemovedFiles`, `maxInternalDepIncrease`, `maxExternalDepIncrease`, `maxDensityIncrease`, `maxNewExternalPackages`) is uncapped by default so teams adopt checks one at a time. Improvements (reductions) never count as drift even under zero-tolerance caps. Exposed via two new CLI commands — `repograph baseline [repo]` (writes `.repograph/baseline.json` by default) and `repograph drift --baseline <path> --fail-on-drift` (exits status `4` when any threshold breaches) — plus the `repograph_drift` MCP tool that accepts inline baseline + head graphs.
- **Architecture Policy v2 rule types** — `require-import` (a glob-matched file set must import at least one matching target), `max-fan-in` (cap incoming import edges per file), `layered` (declare ordered layers with name + glob; engine flags every import that flows "upward" against the declared order, ideal for hexagonal / clean-architecture enforcement), and `naming-convention` (regex pattern applied to basename or full path of files matching a `target` glob). Nine rule types total. The example policy in `examples/policy.example.json` now demonstrates every type.
- **Test Selection** — new `selectTests(graph, changedFiles, options)` walks the graph in reverse (callers → callees) from each changed file and filters dependents through configurable test-path patterns to produce the minimum set of tests CI should run for a given diff. Defaults cover JS/TS/Python/Go conventions (`test/**`, `tests/**`, `**/__tests__/**`, `**/*.{test,spec}.{js,ts,tsx,jsx,mjs,cjs,py}`, `**/*_test.{go,py}`); the CLI accepts `--patterns "glob,glob"` to override. Report shape: `{ changedFiles, affectedFiles, tests, summary }` with risk verdict, blast radius, and a selection-ratio percent. Exposed via `repograph test-select [repo] --changed "a.ts,b.ts" [--depth n] [--patterns ...]` and the `repograph_test_select` MCP tool.

## [0.2.0] - 2026-05-14

### Added

- **Web explorer: dark mode + export buttons** — header now carries an "Export Mermaid" button, an "Export DOT" button, and a theme toggle. Both export buttons hit a new `POST /api/export` endpoint that delegates to the core `toMermaid` / `toDot` converters and returns the diagram as a downloadable blob; client-side, the response is wrapped in an `Anchor + URL.createObjectURL` flow and saved as `repograph.mmd` or `repograph.dot`. The theme toggle flips a `data-theme="dark"` attribute on `<html>` (persisted in `localStorage`, defaulting to `prefers-color-scheme`) and a focused dark-palette layer overrides the relevant surfaces — header, inspector, action result, graph stage — without touching the existing light-mode rules.
- **GraphViz / DOT export** — new `toDot(graph, options)` core function emits GraphViz DOT source that renders in Graphviz dot/neato/twopi, Gephi, yEd, and any tool that consumes DOT. Sister export to `toMermaid` with a matching option matrix (`rankdir`, symbol/package/contains filters, node/edge caps, stable alias IDs). `rankdir` accepts the Mermaid-style `TD` value as an alias for GraphViz `TB` so the CLI flags carry across both commands. Node attributes color-code file/symbol/package types so a basic `dot -Tpng` invocation produces a readable diagram with no further configuration. Exposed via `repograph dot` and the `repograph_dot` MCP tool.
- **Test Coverage Overlay** — new `packages/core/src/coverage.js` ingests LCOV tracefiles (Istanbul, c8, pytest-cov, jacoco) and attaches per-file `coverage` metadata (line, branch, function percentages, raw hit counts) to file nodes. Path matching tries exact → suffix → basename, with the basename fallback marked `weakMatch: true`. New `rankByCoverageRisk(graph, coverage, options)` combines `scoreDependencyRisk` with the inverse line coverage to surface high-risk low-coverage files first; the `coverageThreshold` option (default 80%) filters out fully-covered files so the report stays focused. Exposed via the `repograph coverage` CLI command (`--lcov`, `--rank`, `--limit`, `--coverage-threshold`) and the `repograph_coverage` MCP tool, which accepts the LCOV payload inline (capped by the 1 MB JSON-RPC envelope — for larger tracefiles use the CLI which reads from disk with a 10 MB default cap).
- **API Surface Diff** — new `diffApiSurface(baseGraph, headGraph, options)` core function compares two RepoGraph snapshots and classifies every exported symbol as added, removed, or changed (when the underlying symbol kind transitions, e.g., `function` → `class`). Reports per-file groupings, lists of files whose entire export set appeared or disappeared, and an aggregate `breaking` count (removed + changed). Exposed via the `repograph api-diff` CLI command (with optional `--fail-on-breaking` that exits with status `3`) and the `repograph_api_diff` MCP tool. Foundation for PR-review automation and release-notes generation.
- **Architecture Policy as Code** — new `packages/core/src/policy.js` engine with five v1 rule types (`forbid-import`, `forbid-dependency`, `no-cycles`, `max-imports`, `max-lines`), per-rule severity (`info`/`warning`/`error`), and a glob matcher (`**`, `*`, `?`) used to scope rules to subtrees. Exposed via the `repograph policy` CLI command (exits non-zero on violations meeting `--fail-on` threshold), the `repograph_policy` MCP tool (accepts inline `policy` or `policyPath`), and a sample [`examples/policy.example.json`](examples/policy.example.json).
- **Project picker in the web explorer** — header input + `Open Project` button that switches the analyzed repository at runtime. Server analyzes the new root synchronously and returns the graph in the response so the visualization swaps immediately.
- **Live graph refetch via SSE** — when the watcher rebuilds, the explorer pulls the latest graph via a new `GET /api/graph` endpoint and re-renders. Sequence-counted on the client to drop out-of-order responses.
- **Summary / JSON result toggle** — every action result now renders a human-readable Summary view (from `compressContext` or per-action formatters) alongside the raw JSON, with a `Copy JSON for LLM` button that copies the structured payload to the clipboard.
- **Mermaid flowchart export** — new `toMermaid(graph, options)` core function and `repograph mermaid` CLI command produce GitHub/GitLab/Notion-renderable diagrams from any analyzed graph. Supports direction, symbol/package/contains filters, deterministic alias IDs, and explicit node/edge caps for monorepo-friendly truncation.
- **`repograph_mermaid` MCP tool** — exposes the Mermaid converter to AI agents over the MCP stdio server. Returns `{ mermaid, options }` so the calling agent receives both the diagram source and the parameters that produced it.

### Changed

- The legacy `Load graph` upload button is now `Import graph JSON`, with a tooltip clarifying it loads a previously saved `.repograph/graph.json` for offline viewing rather than analyzing a fresh project.
- CLI `mermaid --direction` now validates against the `LR/TD/TB/RL/BT` enum and throws on unknown values instead of silently coercing to `LR`. Brings parity with the MCP tool, which already rejected unknown directions.

### Fixed

- `escapeLabel` in the Mermaid exporter now defangs pipe (`|`), backtick (`` ` ``), and curly brace (`{`, `}`) characters in node labels in addition to quotes, backslashes, newlines, and angle brackets. Prevents malicious or accidental file names from breaking the surrounding flowchart syntax.

### Security

- **`/api/set-root` hardening** — the project-picker endpoint resolves paths with `fs.realpath` to defeat symlink escapes; enforces containment with `path.relative` (not `String.prototype.startsWith`) to close the prefix-bypass class (`/allowed-evil` against `/allowed`); rejects empty, oversize (>4096), or NUL-containing input; and serializes concurrent requests with an in-flight mutex released in `try/finally` so root-switch races cannot corrupt mutable server state.
- Optional `REPOGRAPH_ALLOWED_ROOTS` environment variable (comma-separated absolute directories) restricts which paths the explorer is allowed to analyze. Defeats both prefix-bypass and symlink-escape attempts when set.
- Mermaid export sanitizes user-controlled labels against parse-significant characters before emission. Defends downstream renderers that interpret HTML/markdown inside node labels.

### Tests

- Test count moves from 24 → 58 across the work since `0.1.0`:
  - 5 unit tests for `toMermaid` (default render, option matrix, truncation annotation, label escaping, malformed input)
  - 1 additional Mermaid escaping test covering pipes, backticks, and braces
  - 2 MCP integration tests for `repograph_mermaid` (tool advertisement, invalid-direction error)
  - 6 tests for the policy engine covering glob matcher semantics, schema validation, violation detection across all five rule types, cycle deduplication within scope, `failOn` threshold behavior, and on-disk `.json` policy loading
  - 7 tests for `diffApiSurface` covering classification across added/removed/changed, whole-file appearance/disappearance, per-file grouping, identical-graph short-circuit with `includeFileSummary: false`, malformed input rejection, name trimming and empty-path skipping, and duplicate-export conflict marking
  - 6 tests for the coverage overlay engine covering LCOV parsing (line/branch/function percentages, divide-by-zero handling, malformed-line tolerance, non-string input rejection), three-tier path matching (exact / suffix / basename), the `allowBasenameMatch=false` knob, the risk-coverage priority ranking with threshold filtering, and disk loading via `loadLcov`
  - 5 tests for `toDot` covering default rendering, `TD → TB` rankdir aliasing plus invalid-rankdir rejection, label escaping for quotes/backslashes/control chars/long names, truncation annotation, and malformed-input rejection

## [0.1.0] - 2026-05-01

Initial public release.

### Added

- Dependency graph extraction for JavaScript, TypeScript, Python, and Rust sources
- CLI with commands for graph build, search, architecture summary, and change-impact analysis
- MCP server exposing repository intelligence as tools for AI assistants
- Web explorer with live SSE updates and filesystem watch mode
- Supply-chain audit: manifest parsing, license classification, and optional `--online` OSV.dev advisory cross-checks
- Watch mode with debounced incremental rebuilds
- Source masker for safe extraction across template literals and JSX
- Rust core for parser engine and storage primitives
- 24 test cases covering core graph behavior, CLI output, supply-chain, watch lifecycle, and source masking

### Security

- Host allowlist, `Sec-Fetch-Site` enforcement, and Origin/Referer validation on the local web server (CORS bypass and DNS rebinding hardening)
- `execFile` with array arguments and `--` option-parsing terminator for all subprocess calls
- Explicit allowlists for user-supplied git refs and paths
- Single `fs.open` handle for stat-then-read on user-controlled paths (TOCTOU prevention)
- Bounded file read sizes
- Zero external production dependencies in core (full inspectability)

[Unreleased]: https://github.com/Rajveerx11/repograph-intelligence/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Rajveerx11/repograph-intelligence/releases/tag/v0.2.0
[0.1.0]: https://github.com/Rajveerx11/repograph-intelligence/releases/tag/v0.1.0
