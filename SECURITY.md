# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| 0.1.x   | No (upgrade to 0.2.x) |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities through [GitHub Security Advisories](https://github.com/Rajveerx11/repograph-intelligence/security/advisories/new).

### Response Timeline

- **Acknowledgment**: within 48 hours
- **Assessment and triage**: within 7 days
- **Fix for critical issues**: within 14 days

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could achieve)
- Suggested fix, if any

## Scope

The following components are in scope for security reports:

- **CLI** (`packages/cli`) — command injection, path traversal, ref injection, option-parsing bypass
- **MCP server** (`packages/mcp`) — input validation, tool abuse, path-allowlist bypass
- **Web server** (`apps/web`) — CORS bypass, DNS rebinding, XSS, SSRF, project-root switch race or escape
- **Supply-chain audit** — manifest parsing, advisory fetching
- **Mermaid export** (`packages/core/src/mermaid.js`) — label injection into downstream Markdown/HTML renderers
- **GraphViz DOT export** (`packages/core/src/dot.js`) — label injection into DOT-consuming tooling (Graphviz, Gephi, yEd)
- **Architecture policy engine** (`packages/core/src/policy.js`) — policy-file size bound, glob-pattern injection (the matcher escapes every regex metacharacter except `*` and `?`), regex pattern length cap on `naming-convention`, and self-import / duplicate-edge dedup defences in `require-import` and `max-fan-in`
- **Drift gate** (`packages/core/src/drift.js`) — snapshot-spoofing defences in `ensureSnapshot` (a graph that fakes only the `schema` string is re-snapshotted rather than accepted as a baseline)
- **Docker image** (`Dockerfile`) — supply-chain protection via `--ignore-scripts` at install time, non-root `repograph` runtime user, no shell on the entrypoint path, and multi-arch images published by the tag-triggered `release.yml` workflow with `GITHUB_TOKEN` only (no broad PATs)

## Security Design

RepoGraph performs local static analysis. No data leaves the machine unless the user explicitly opts in (e.g., `--online` for OSV advisory checks).

Key hardening measures:

- **Subprocess calls** use `execFile` with array arguments; user-supplied refs and paths are validated against explicit allowlists; `--` terminates option parsing for positional arguments.
- **File I/O** on user-controlled paths uses a single `fs.open` handle for stat-then-read to eliminate TOCTOU windows. File sizes are bounded.
- **Web server** enforces a Host allowlist, `Sec-Fetch-Site` validation, and Origin/Referer checks to prevent CORS bypass and DNS rebinding.
- **Project-root switch endpoint** (`POST /api/set-root`) resolves submitted paths with `fs.realpath` to defeat symlink escapes; enforces containment with `path.relative` (not `String.prototype.startsWith`) so prefix-bypass attempts (`/allowed-evil` against `/allowed`) are rejected; rejects empty, oversize (> 4096 chars), or NUL-containing input; and serializes concurrent requests with an in-flight mutex released in `try/finally` so a root-switch race cannot corrupt mutable server state. The optional `REPOGRAPH_ALLOWED_ROOTS` environment variable (comma-separated absolute directories) further restricts which paths the explorer is allowed to analyze.
- **Path allowlist in the MCP server** — the same `realpath` + `path.relative` containment check guards every tool invocation that takes a `repoPath`, including `repograph_mermaid`. The default allowlist is the process working directory; operators can broaden or narrow it via `REPOGRAPH_ALLOWED_ROOTS`.
- **Mermaid + DOT export label sanitization** — both exporters defang parse-significant characters in node labels and truncate labels longer than 60 characters with an ellipsis. Prevents an adversarial or accidental file name from breaking the surrounding diagram syntax or injecting HTML/markdown into downstream renderers.
- **Architecture policy engine** — policy files are size-bounded (default 1 MB), restricted to `.json` until a vetted YAML loader is added behind a dynamic import, and the glob compiler escapes every regex metacharacter except `*` and `?` so a hostile pattern cannot inject regex. The `naming-convention` rule caps its user-supplied regex at 512 characters; consumers of long file names should still vet patterns for catastrophic-backtracking shapes since the engine evaluates the regex against every matching node. The `require-import` and `max-fan-in` evaluators ignore self-imports and deduplicate `(from, to)` edge pairs so a hostile or duplicated graph cannot satisfy or inflate a rule.
- **Drift gate** — the baseline loader requires snapshot marker fields (`schema` string plus a `fingerprint` string plus a `files` array) before treating an input as a pre-built snapshot. A graph that fakes only the `schema` string is re-snapshotted via `createGraphSnapshot`, so a tampered baseline cannot silently smuggle metrics past the drift check. Threshold checks coerce negative deltas (improvements) to zero so structural reductions never fail the gate.
- **Docker image hardening** — `npm install --ignore-scripts` at build time blocks arbitrary postinstall code execution from transitive dependencies; the runtime image runs as a non-root `repograph` user; the ENTRYPOINT is the Node CLI directly with no shell wrapper, removing a class of command-injection vectors; and the tag-triggered `release.yml` workflow uses `GITHUB_TOKEN` with the minimum `packages: write` permission to publish to GHCR. The release tarball is smoke-tested in CI by extracting and running the CLI in a fresh directory before upload.
- **CLI exit-code contract** — distinct codes (`2`, `3`, `4`) per gate (policy, api-diff, drift) so CI pipelines can branch on which check failed without parsing output.
- **No external production dependencies** in core — the entire runtime is inspectable without auditing third-party code.

## Coordinated Disclosure

We follow coordinated disclosure. After a fix is released, we will:

1. Credit the reporter (unless they prefer anonymity)
2. Publish a GitHub Security Advisory with details
3. Tag a patch release

We ask reporters to allow a reasonable window (up to 90 days) before public disclosure.
