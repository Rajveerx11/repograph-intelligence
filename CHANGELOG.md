# Changelog

All notable changes to RepoGraph Intelligence are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/Rajveerx11/repograph-intelligence/releases/tag/v0.1.0
