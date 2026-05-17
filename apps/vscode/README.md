# RepoGraph Intelligence — VS Code Extension

Surface structural repository intelligence inline in your editor. Blast radius, dependency risk, architecture policy verdicts, and drift gates — all driven by the local RepoGraph MCP server (no cloud, no API keys, no telemetry).

## Features

- **Blast Radius CodeLens** above the first top-level declaration of every JS / TS / Python file: `RepoGraph · blast radius 12 (4 direct) · risk medium`. Click to open a full impact report.
- **Risk Ranking Sidebar** in the activity bar: high-risk files ranked by combined fan-in, fan-out, and external-dependency pressure. Click a row to open the file; expand for the reasons the file is flagged.
- **Commands** (Command Palette → `RepoGraph: …`):
  - `Analyze Workspace` — refresh the graph and the risk view.
  - `Show Blast Radius for Active File` — print a markdown report with direct and transitive dependents.
  - `Run Architecture Policy` — load `.repograph/policy.json` and surface violations as a markdown report.
  - `Check Drift Against Baseline` — load `.repograph/baseline.json` and render a per-metric drift table.
- **Status bar item** — click to refresh the risk view.

The extension spawns the canonical RepoGraph MCP server as a child process and speaks JSON-RPC over stdio. It does not embed its own analyzer; every result you see comes from the same `repograph` CLI you can run from a terminal.

## Requirements

- VS Code 1.84.0 or newer
- Node.js 20 or newer on `PATH` (the extension spawns the MCP server via `npx`)
- A workspace folder (the extension does nothing useful in a single-file window)

## Configuration

| Setting | Default | Description |
|---|---|---|
| `repograph.mcpCommand` | `npx` | Command to launch the MCP server. Override with an absolute path if `repograph-intelligence` is installed globally. |
| `repograph.mcpArgs` | `["-y", "repograph-intelligence", "mcp"]` | Arguments passed to the launcher. |
| `repograph.riskLimit` | `20` | Maximum rows shown in the Risk Ranking sidebar (1–200). |
| `repograph.codelens.enabled` | `true` | Toggle the blast-radius CodeLens. |
| `repograph.policyPath` | `.repograph/policy.json` | Workspace-relative policy file for the Run Architecture Policy command. |
| `repograph.baselinePath` | `.repograph/baseline.json` | Workspace-relative baseline snapshot for the Check Drift command. |

## Install (development)

```bash
cd apps/vscode
npm install
npm run compile
npm run package         # produces a .vsix file
code --install-extension repograph-intelligence-vscode-0.4.0.vsix
```

To run from source against the Extension Development Host:

```bash
cd apps/vscode
npm install
npm run watch           # leave running in one terminal
# In VS Code: open apps/vscode, press F5
```

## Security notes

The extension only reads two workspace-relative paths on demand (the policy file and the baseline snapshot). It never writes to disk, never makes network calls, and never opens TCP sockets. The MCP server it spawns inherits its own path-allowlist (the workspace root by default) and the same security posture as the CLI — see [SECURITY.md](../../SECURITY.md) in the root of this repository.
