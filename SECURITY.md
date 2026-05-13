# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

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

## Security Design

RepoGraph performs local static analysis. No data leaves the machine unless the user explicitly opts in (e.g., `--online` for OSV advisory checks).

Key hardening measures:

- **Subprocess calls** use `execFile` with array arguments; user-supplied refs and paths are validated against explicit allowlists; `--` terminates option parsing for positional arguments.
- **File I/O** on user-controlled paths uses a single `fs.open` handle for stat-then-read to eliminate TOCTOU windows. File sizes are bounded.
- **Web server** enforces a Host allowlist, `Sec-Fetch-Site` validation, and Origin/Referer checks to prevent CORS bypass and DNS rebinding.
- **Project-root switch endpoint** (`POST /api/set-root`) resolves submitted paths with `fs.realpath` to defeat symlink escapes; enforces containment with `path.relative` (not `String.prototype.startsWith`) so prefix-bypass attempts (`/allowed-evil` against `/allowed`) are rejected; rejects empty, oversize (> 4096 chars), or NUL-containing input; and serializes concurrent requests with an in-flight mutex released in `try/finally` so a root-switch race cannot corrupt mutable server state. The optional `REPOGRAPH_ALLOWED_ROOTS` environment variable (comma-separated absolute directories) further restricts which paths the explorer is allowed to analyze.
- **Path allowlist in the MCP server** — the same `realpath` + `path.relative` containment check guards every tool invocation that takes a `repoPath`, including `repograph_mermaid`. The default allowlist is the process working directory; operators can broaden or narrow it via `REPOGRAPH_ALLOWED_ROOTS`.
- **Mermaid export label sanitization** — `toMermaid` defangs quotes, backslashes, newlines, angle brackets, pipes, backticks, and curly braces in node labels, and truncates labels longer than 60 characters with an ellipsis. Prevents an adversarial or accidental file name from breaking the surrounding flowchart syntax or injecting HTML/markdown into downstream renderers.
- **No external production dependencies** in core — the entire runtime is inspectable without auditing third-party code.

## Coordinated Disclosure

We follow coordinated disclosure. After a fix is released, we will:

1. Credit the reporter (unless they prefer anonymity)
2. Publish a GitHub Security Advisory with details
3. Tag a patch release

We ask reporters to allow a reasonable window (up to 90 days) before public disclosure.
