import * as vscode from "vscode";
import * as path from "node:path";
import { McpClient } from "./mcp-client.js";

interface RiskRow {
  path: string;
  level: string;
  score: number;
  incoming: number;
  outgoing: number;
  externalDependencies: number;
  reasons?: string[];
}

interface SecuritySnapshot {
  findings?: Array<{ severity: string; message: string; target?: string }>;
}

/**
 * Tree provider for the "Risk Ranking" sidebar. Calls `repograph_analyze`
 * to refresh metrics and `repograph_security` for the headline finding
 * count. Rows are clickable — clicking a file opens it in the editor.
 */
export class RiskViewProvider implements vscode.TreeDataProvider<RiskItem> {
  private readonly _onDidChange = new vscode.EventEmitter<RiskItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private rows: RiskItem[] = [];
  private status: RiskItem | null = null;
  private refreshing = false;

  constructor(
    private readonly client: McpClient,
    private readonly workspaceRoot: () => string | undefined,
    private readonly limit: () => number
  ) {}

  getTreeItem(item: RiskItem): vscode.TreeItem {
    return item;
  }

  getChildren(element?: RiskItem): vscode.ProviderResult<RiskItem[]> {
    if (element) {
      return element.children;
    }
    const header: RiskItem[] = [];
    if (this.status) {
      header.push(this.status);
    }
    return [...header, ...this.rows];
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    const root = this.workspaceRoot();
    if (!root) {
      this.rows = [];
      this.status = makeStatus("No workspace folder open.", "info");
      this._onDidChange.fire(undefined);
      return;
    }
    this.refreshing = true;
    this.status = makeStatus("Analyzing repository…", "loading");
    this._onDidChange.fire(undefined);
    try {
      const analyzeResult = await this.client.callTool<{
        metrics?: { files?: number; symbols?: number; circularDependencies?: string[] };
      }>("repograph_analyze", { repoPath: root });

      const securityResult = await this.client
        .callTool<SecuritySnapshot>("repograph_security", { repoPath: root, limit: this.limit() })
        .catch(() => null);

      // The `repograph_security` tool already ranks risks; reuse its
      // critical-blast-zone list as our row source. If it returns
      // nothing useful, fall back to an empty list rather than crash.
      const criticalRows = ((securityResult as unknown) as {
        criticalBlastZones?: RiskRow[];
      } | null)?.criticalBlastZones ?? [];

      this.rows = criticalRows.slice(0, this.limit()).map((row) => buildRow(row, root));

      const metrics = analyzeResult.metrics;
      const summary = metrics
        ? `${metrics.files ?? 0} files · ${metrics.symbols ?? 0} symbols · ${metrics.circularDependencies?.length ?? 0} cycles`
        : "Analyzed.";
      this.status = makeStatus(summary, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed.";
      this.rows = [];
      this.status = makeStatus(`Risk view error: ${message}`, "error");
    } finally {
      this.refreshing = false;
      this._onDidChange.fire(undefined);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

class RiskItem extends vscode.TreeItem {
  children: RiskItem[] = [];
}

function makeStatus(message: string, kind: "info" | "loading" | "ok" | "error"): RiskItem {
  const item = new RiskItem(message, vscode.TreeItemCollapsibleState.None);
  const iconByKind: Record<typeof kind, string> = {
    info: "info",
    loading: "sync~spin",
    ok: "pass",
    error: "error"
  };
  item.iconPath = new vscode.ThemeIcon(iconByKind[kind]);
  item.contextValue = `status-${kind}`;
  return item;
}

function buildRow(row: RiskRow, workspaceRoot: string): RiskItem {
  const item = new RiskItem(row.path, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = `${row.level} · score ${row.score}`;
  item.tooltip = new vscode.MarkdownString(
    [
      `**${row.path}**`,
      "",
      `Level: \`${row.level}\``,
      `Score: \`${row.score}\``,
      `Incoming: \`${row.incoming}\`, Outgoing: \`${row.outgoing}\`, External: \`${row.externalDependencies}\``,
      ...(row.reasons?.length ? ["", "Reasons:", ...row.reasons.map((r) => `- ${r}`)] : [])
    ].join("\n")
  );
  item.iconPath = new vscode.ThemeIcon(
    row.level === "high" ? "error" : row.level === "medium" ? "warning" : "info"
  );
  // Defence-in-depth: only wire up `vscode.open` when the MCP-returned
  // path is a workspace-relative path that resolves inside the
  // workspace root. The canonical RepoGraph MCP server only ever emits
  // relative paths, but a tampered server (or a future tool) could
  // return absolute or `..`-prefixed paths; we refuse to make those
  // clickable so a click cannot read `/etc/passwd` or similar.
  const target = safeJoinUnderWorkspace(workspaceRoot, row.path);
  if (target) {
    item.command = {
      command: "vscode.open",
      title: "Open file",
      arguments: [vscode.Uri.file(target)]
    };
  } else {
    const baseTooltip = item.tooltip instanceof vscode.MarkdownString ? item.tooltip.value : "";
    item.tooltip = new vscode.MarkdownString(
      `${baseTooltip}\n\n_⚠ Path '${row.path}' is outside the workspace root and was not made clickable._`
    );
  }

  if (row.reasons?.length) {
    item.children = row.reasons.map((reason) => {
      const sub = new RiskItem(reason, vscode.TreeItemCollapsibleState.None);
      sub.iconPath = new vscode.ThemeIcon("debug-stackframe-dot");
      return sub;
    });
  }
  return item;
}

/**
 * Join an MCP-supplied relative path against the workspace root and
 * verify the result stays inside that root. Returns `null` when the
 * input is absolute (Windows drive letters, POSIX `/...`, or UNC
 * `\\server\...`) or escapes via `..`. Callers should treat `null` as
 * "do not turn this row into a clickable link".
 */
function safeJoinUnderWorkspace(base: string, candidate: string): string | null {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }
  // Reject absolute paths in any common form.
  if (path.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\")) {
    return null;
  }
  const resolved = path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}
