# Contributing to RepoGraph Intelligence

Thanks for your interest in contributing. RepoGraph Intelligence is early, intentionally small, and focused on one core idea: structural repository intelligence should be explainable, local-first, and useful to both developers and AI systems.

## What To Work On

High-value contribution areas:

- Parser support for more language constructs (decorators, namespace imports, generics, dynamic imports)
- Tree-sitter-backed extraction in the Rust parser engine, plus moving the JS pipeline onto a real AST when regex-plus-masker saturates
- Hardening the source masker against tricky template-literal nesting and JSX edge cases
- Graph algorithms for coupling, cycles, ownership, and impact analysis
- Architecture rules and recommendation quality
- Supply-chain auditing: more manifest formats (Gemfile, go.mod, pnpm/yarn lockfiles), advisory caching, license-policy rules
- Watch mode: incremental graph mutation instead of full rebuilds, smarter ignore globs, large-monorepo benchmarks
- Web explorer: SSE reconnection UX, graph diff overlays, keyboard navigation, project-picker UX (recent projects, drag-drop folder, validation feedback)
- MCP tool ergonomics, including new tools for watch state and supply-chain
- Rust storage and traversal hardening
- CLI output formats for CI and pull request workflows
- Test fixtures that model real repository shapes
- Documentation, examples, and graph schema notes

## Development Setup

Requirements:

- Node.js 20 or newer
- npm
- Git
- Rust toolchain (`cargo`, `rustc`) for Rust core changes

Install and verify:

```bash
npm test
npm run check
npm run web:build
```

Run the CLI locally:

```bash
npm run repograph -- help
```

Run the dependency audit and a one-shot supply-chain scan:

```bash
npm run audit
npm run repograph -- supply-chain .
```

Try live watch mode end-to-end:

```bash
npm run repograph -- watch . --debounce 250
```

Bring up the explorer with the SSE live indicator (the server starts the watcher automatically; set `REPOGRAPH_WATCH=0` to disable):

```bash
npm run web
```

The explorer header has a project-root input and **Open Project** button. Paste any local folder path and the server runs analysis on that path, swaps the watcher, and renders the resulting graph. To restrict which paths the explorer can open, set `REPOGRAPH_ALLOWED_ROOTS` to a comma-separated list of absolute directories before starting the server:

```bash
REPOGRAPH_ALLOWED_ROOTS="/Users/me/code" npm run web
```

Path checks resolve symlinks via `realpath` and use `path.relative` containment (not raw `startsWith`), so prefix-bypass attempts and symlink escapes are rejected. Concurrent `/api/set-root` requests are serialized to prevent root-switch races mid-analyze.

## Pull Request Guidelines

Before opening a pull request:

1. Keep the change focused on one behavior or capability.
2. Add or update tests in `test/core.test.js` or `test/features.test.js` for graph behavior, CLI behavior, supply-chain output, watch lifecycle, or extractor accuracy.
3. Run `npm run check`, `npm test`, and `npm run web:build`. Tests must stay green; the existing 24 cases are the floor.
4. When adding a network-touching feature (such as OSV advisories), expose an injectable `fetch` so tests can assert behavior offline.
5. Update `README.md`, `CONTRIBUTING.md`, or files under `docs/` when user-facing behavior changes.
6. Describe the repository behavior being modeled and any tradeoffs in the implementation.

For Rust core changes, also run:

```bash
cargo test --workspace
```

## Code Style

- Prefer small modules with explicit exports.
- Keep analysis outputs structured and machine-readable where possible.
- Preserve local-first behavior; do not require cloud credentials for core features. Network calls must be opt-in (see `--online` for supply-chain) and must degrade gracefully when offline.
- Favor deterministic heuristics before introducing model-backed behavior.
- Avoid broad refactors unless they are required for the feature.
- Use `execFile` with array arguments for any subprocess call. Validate user-supplied refs/paths with explicit allowlists before passing them to child processes, and append `--` to terminate option parsing wherever positional arguments may be user-controlled.
- For file I/O on user-controlled paths, prefer a single `fs.open` handle for stat-then-read so there is no TOCTOU window.
- For directory containment checks, use `path.relative(parent, child)` and reject results that start with `..` or are absolute, instead of `String.prototype.startsWith`. Resolve symlinks with `fs.realpath` before the containment check so `/allowed/link → /etc` cannot escape the allowlist.
- Serialize state-mutating endpoints (such as `/api/set-root`) with an in-flight flag and `try/finally` lock release, so concurrent requests cannot corrupt mutable server state mid-operation.

## Reporting Issues

When opening an issue, include:

- The repository language or framework involved
- The command you ran
- Expected behavior
- Actual behavior
- A small reproduction or fixture when possible

## Security

RepoGraph performs local static analysis. Architecture-focused security features highlight sensitive blast zones, wide dependency surfaces, cycles, and coupling patterns. The supply-chain audit additionally parses dependency manifests, classifies licenses, and (with `--online`) cross-checks OSV.dev for known advisories.

The local web server is hardened against CORS bypass and DNS rebinding through a Host allowlist, `Sec-Fetch-Site` enforcement, and Origin/Referer validation. The CLI hardens git-backed commands by validating user-supplied refs and terminating option parsing with `--`. File reads bound size and use a single open handle to eliminate TOCTOU windows.

The `/api/set-root` endpoint that lets the explorer open arbitrary projects validates input as follows: rejects empty, oversize (>4096), or NUL-containing paths; resolves the path with `fs.realpath` to defeat symlink escapes; checks containment against `REPOGRAPH_ALLOWED_ROOTS` (when set) using `path.relative` (not `startsWith`); confirms the target is a directory via `stat`; and serializes concurrent requests with an in-flight lock released in `finally`. Run the server with `REPOGRAPH_ALLOWED_ROOTS` set to a comma-separated allowlist whenever the explorer is exposed to untrusted local users.

To report a security issue, see [SECURITY.md](SECURITY.md). Do not open a public issue with reproduction details for an unfixed vulnerability.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
