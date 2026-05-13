# Changelog

All notable changes to RepoGraph Intelligence are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Test count moves from 24 → 32 across the work since `0.1.0`:
  - 5 unit tests for `toMermaid` (default render, option matrix, truncation annotation, label escaping, malformed input)
  - 1 additional Mermaid escaping test covering pipes, backticks, and braces
  - 2 MCP integration tests for `repograph_mermaid` (tool advertisement, invalid-direction error)

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

[Unreleased]: https://github.com/Rajveerx11/repograph-intelligence/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Rajveerx11/repograph-intelligence/releases/tag/v0.1.0
