import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { McpClient } from "./mcp-client.js";
import { RiskViewProvider } from "./risk-view.js";
import { BlastRadiusCodeLensProvider } from "./codelens.js";

let client: McpClient | null = null;
let riskProvider: RiskViewProvider | null = null;
let lensProvider: BlastRadiusCodeLensProvider | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let output: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("RepoGraph");
  context.subscriptions.push(output);

  const config = () => vscode.workspace.getConfiguration("repograph");
  const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Refuse to spawn the MCP subprocess in an untrusted workspace.
  // A hostile `.vscode/settings.json` could otherwise set
  // `repograph.mcpCommand` to an arbitrary binary and execute it the
  // moment the workspace opens. Untrusted workspaces still see the
  // extension's commands in the palette but each command no-ops with a
  // friendly message rather than a crash.
  if (!vscode.workspace.isTrusted) {
    output.appendLine(
      "RepoGraph is disabled in this untrusted workspace. Mark the folder as trusted to enable analysis."
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      })
    );
    const guard = () =>
      vscode.window.showWarningMessage(
        "RepoGraph: this workspace is not trusted. Mark the folder as trusted (File → Restricted Mode) to run analysis."
      );
    context.subscriptions.push(
      vscode.commands.registerCommand("repograph.analyze", guard),
      vscode.commands.registerCommand("repograph.showBlastRadius", guard),
      vscode.commands.registerCommand("repograph.runPolicy", guard),
      vscode.commands.registerCommand("repograph.runDrift", guard),
      vscode.commands.registerCommand("repograph.refreshRiskView", guard)
    );
    return;
  }

  client = new McpClient({
    command: config().get<string>("mcpCommand", "npx"),
    args: config().get<string[]>("mcpArgs", ["-y", "repograph-intelligence", "mcp"]),
    cwd: workspaceRoot()
  });
  context.subscriptions.push({ dispose: () => client?.dispose() });

  riskProvider = new RiskViewProvider(client, workspaceRoot, () => config().get<number>("riskLimit", 20));
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("repographRiskView", riskProvider),
    { dispose: () => riskProvider?.dispose() }
  );

  lensProvider = new BlastRadiusCodeLensProvider(client, workspaceRoot, () =>
    config().get<boolean>("codelens.enabled", true)
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "typescriptreact" },
        { scheme: "file", language: "javascript" },
        { scheme: "file", language: "javascriptreact" },
        { scheme: "file", language: "python" }
      ],
      lensProvider
    )
  );

  // Invalidate the CodeLens cache on save so users see the updated blast
  // radius after they touch a file. A workspace-wide listener is cheap.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => lensProvider?.invalidate(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("repograph.codelens.enabled")) {
        lensProvider?.invalidate();
      }
    })
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  statusBar.text = "$(graph-line) RepoGraph";
  statusBar.tooltip = "Click to refresh the risk view";
  statusBar.command = "repograph.refreshRiskView";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("repograph.analyze", () => runAnalyze(workspaceRoot)),
    vscode.commands.registerCommand("repograph.showBlastRadius", () => runShowBlastRadius(workspaceRoot)),
    vscode.commands.registerCommand("repograph.runPolicy", () =>
      runPolicy(workspaceRoot, config().get<string>("policyPath", ".repograph/policy.json"))
    ),
    vscode.commands.registerCommand("repograph.runDrift", () =>
      runDrift(workspaceRoot, config().get<string>("baselinePath", ".repograph/baseline.json"))
    ),
    vscode.commands.registerCommand("repograph.refreshRiskView", () => riskProvider?.refresh())
  );

  // Best-effort warm-up — start the MCP server in the background so the
  // first user command does not pay the cold-start cost. Failures are
  // surfaced through the output channel rather than as a popup.
  client.start().catch((error) => {
    output?.appendLine(`MCP start failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export function deactivate(): void {
  client?.dispose();
  client = null;
  riskProvider?.dispose();
  riskProvider = null;
  statusBar = null;
  output = null;
}

async function runAnalyze(workspaceRoot: () => string | undefined): Promise<void> {
  const root = workspaceRoot();
  if (!root || !client) {
    vscode.window.showErrorMessage("RepoGraph: no workspace folder open.");
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "RepoGraph: Analyzing repository…" },
    async () => {
      try {
        const summary = await client!.callTool<{ overview?: string; metrics?: { files?: number; symbols?: number } }>(
          "repograph_analyze",
          { repoPath: root }
        );
        const overview = summary.overview ?? "Repository analyzed.";
        const files = summary.metrics?.files ?? 0;
        const symbols = summary.metrics?.symbols ?? 0;
        await showInDocument(`# RepoGraph Analysis\n\n${overview}\n\nFiles: ${files}, Symbols: ${symbols}\n`);
        riskProvider?.refresh();
        lensProvider?.invalidate();
      } catch (error) {
        vscode.window.showErrorMessage(`RepoGraph analyze failed: ${prettyError(error)}`);
      }
    }
  );
}

async function runShowBlastRadius(workspaceRoot: () => string | undefined): Promise<void> {
  const root = workspaceRoot();
  const editor = vscode.window.activeTextEditor;
  if (!root || !editor || !client) {
    vscode.window.showErrorMessage("RepoGraph: open a file inside a workspace first.");
    return;
  }
  const relative = path.relative(root, editor.document.uri.fsPath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("..")) {
    vscode.window.showErrorMessage("RepoGraph: the active file is not inside the workspace.");
    return;
  }
  try {
    const impact = await client.callTool<{
      blastRadius: number;
      directDependents?: string[];
      transitiveDependents?: Array<{ path: string; depth: number }>;
      risk?: { level: string; reason: string };
    }>("repograph_impact", { repoPath: root, changedFiles: [relative] });

    const lines = [
      `# Blast Radius — ${relative}`,
      "",
      `- Blast radius: **${impact.blastRadius}** file(s)`,
      `- Risk: **${impact.risk?.level ?? "n/a"}** (${impact.risk?.reason ?? "no reason recorded"})`,
      "",
      "## Direct dependents",
      ...(impact.directDependents?.length ? impact.directDependents.map((p) => `- ${p}`) : ["_(none)_"]),
      "",
      "## Transitive dependents",
      ...((impact.transitiveDependents?.length
        ? impact.transitiveDependents.map((row) => `- ${row.path} (depth ${row.depth})`)
        : ["_(none)_"]) as string[])
    ];
    await showInDocument(lines.join("\n"));
  } catch (error) {
    vscode.window.showErrorMessage(`RepoGraph blast-radius failed: ${prettyError(error)}`);
  }
}

async function runPolicy(workspaceRoot: () => string | undefined, policyRelPath: string): Promise<void> {
  const root = workspaceRoot();
  if (!root || !client) {
    vscode.window.showErrorMessage("RepoGraph: no workspace folder open.");
    return;
  }
  const absolutePolicy = resolveInsideWorkspace(root, policyRelPath);
  if (!absolutePolicy) {
    vscode.window.showErrorMessage(
      `RepoGraph: policy path '${policyRelPath}' escapes the workspace. Use a path relative to the workspace root.`
    );
    return;
  }
  try {
    await fs.access(absolutePolicy);
  } catch {
    vscode.window.showErrorMessage(`RepoGraph: policy file not found at ${policyRelPath}.`);
    return;
  }
  try {
    const policyRaw = await fs.readFile(absolutePolicy, "utf8");
    const policy = JSON.parse(policyRaw);
    const report = await client.callTool<{
      passed: boolean;
      counts: { error?: number; warning?: number; info?: number };
      violations: Array<{ ruleId: string; ruleType: string; severity: string; message: string }>;
    }>("repograph_policy", { repoPath: root, policy });

    const heading = report.passed ? "✅ Policy passed" : "❌ Policy failed";
    const lines = [
      `# ${heading}`,
      "",
      `Errors: ${report.counts.error ?? 0}, Warnings: ${report.counts.warning ?? 0}, Info: ${report.counts.info ?? 0}`,
      ""
    ];
    if (report.violations.length === 0) {
      lines.push("_No violations._");
    } else {
      for (const violation of report.violations) {
        lines.push(`- **[${violation.severity.toUpperCase()}] ${violation.ruleId}** (${violation.ruleType}): ${violation.message}`);
      }
    }
    await showInDocument(lines.join("\n"));
  } catch (error) {
    vscode.window.showErrorMessage(`RepoGraph policy failed: ${prettyError(error)}`);
  }
}

async function runDrift(workspaceRoot: () => string | undefined, baselineRelPath: string): Promise<void> {
  const root = workspaceRoot();
  if (!root || !client) {
    vscode.window.showErrorMessage("RepoGraph: no workspace folder open.");
    return;
  }
  const absoluteBaseline = resolveInsideWorkspace(root, baselineRelPath);
  if (!absoluteBaseline) {
    vscode.window.showErrorMessage(
      `RepoGraph: baseline path '${baselineRelPath}' escapes the workspace. Use a path relative to the workspace root.`
    );
    return;
  }
  try {
    await fs.access(absoluteBaseline);
  } catch {
    vscode.window.showErrorMessage(
      `RepoGraph: baseline not found at ${baselineRelPath}. Run \`repograph baseline\` in a terminal first.`
    );
    return;
  }
  try {
    const baselineRaw = await fs.readFile(absoluteBaseline, "utf8");
    const baselineSnapshot = JSON.parse(baselineRaw);
    const report = await client.callTool<{
      passed: boolean;
      summary?: { failedChecks?: string[]; severity?: string; fingerprintChanged?: boolean };
      checks: Array<{ name: string; baseline: number; current: number; delta: number; threshold: number; passed: boolean }>;
    }>("repograph_drift", { repoPath: root, baselineSnapshot });

    const heading = report.passed ? "✅ No drift detected" : "❌ Drift detected";
    const lines = [
      `# ${heading}`,
      "",
      `Severity: ${report.summary?.severity ?? "unknown"}, fingerprint changed: ${report.summary?.fingerprintChanged ?? false}`,
      "",
      "| Check | Baseline | Current | Delta | Threshold | Status |",
      "| --- | --- | --- | --- | --- | --- |"
    ];
    for (const check of report.checks) {
      lines.push(
        `| ${check.name} | ${check.baseline} | ${check.current} | ${check.delta} | ${check.threshold === Infinity ? "∞" : check.threshold} | ${check.passed ? "PASS" : "FAIL"} |`
      );
    }
    if (!report.passed && report.summary?.failedChecks?.length) {
      lines.push("", `Failed checks: ${report.summary.failedChecks.join(", ")}`);
    }
    await showInDocument(lines.join("\n"));
  } catch (error) {
    vscode.window.showErrorMessage(`RepoGraph drift failed: ${prettyError(error)}`);
  }
}

async function showInDocument(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function prettyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Join a config-supplied workspace-relative path against the workspace
 * root and reject anything that escapes via `..` or absolute paths.
 *
 * `path.resolve(root, "/etc/passwd")` returns `/etc/passwd` unchanged,
 * so a naive join would let a hostile workspace setting read arbitrary
 * files on disk. This helper rejects absolute inputs outright and
 * verifies via `path.relative` that the resolved path is contained
 * inside `root`.
 */
function resolveInsideWorkspace(root: string, relativePath: string): string | null {
  if (!relativePath || typeof relativePath !== "string") {
    return null;
  }
  if (path.isAbsolute(relativePath)) {
    return null;
  }
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}
