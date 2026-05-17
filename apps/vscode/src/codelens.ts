import * as vscode from "vscode";
import * as path from "node:path";
import { McpClient } from "./mcp-client.js";

interface ImpactResult {
  blastRadius: number;
  risk?: { level: string; reason: string };
  directDependents?: string[];
}

interface FileCache {
  result: ImpactResult | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * CodeLens above the FIRST top-level construct in a source file with
 * the file's blast-radius score. We don't try to compute per-function
 * blast radius today because the v0.3 graph is file-level; lensing the
 * file once gives the same answer cheaper.
 *
 * The provider caches per-document for 60 s and invalidates on save so
 * a single browse session doesn't fire a flood of MCP requests.
 */
export class BlastRadiusCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  private readonly cache = new Map<string, FileCache>();

  constructor(
    private readonly client: McpClient,
    private readonly workspaceRoot: () => string | undefined,
    private readonly isEnabled: () => boolean
  ) {}

  invalidate(uri?: vscode.Uri): void {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
    this._onDidChange.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.isEnabled() || !isSupported(document)) {
      return [];
    }
    const root = this.workspaceRoot();
    if (!root || !document.uri.fsPath.startsWith(root)) {
      return [];
    }
    const relative = path.relative(root, document.uri.fsPath).replace(/\\/g, "/");
    if (!relative || relative.startsWith("..")) {
      return [];
    }

    const anchor = findAnchor(document);
    if (!anchor) {
      return [];
    }

    const cached = this.cache.get(document.uri.toString());
    let impact: ImpactResult | null = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS ? cached.result : null;
    if (!impact) {
      try {
        impact = await this.client.callTool<ImpactResult>("repograph_impact", {
          repoPath: root,
          changedFiles: [relative]
        });
      } catch {
        // Soft-fail — CodeLens absence is preferable to noisy errors.
        impact = null;
      }
      this.cache.set(document.uri.toString(), { result: impact, fetchedAt: Date.now() });
    }
    if (!impact) {
      return [];
    }

    const directs = impact.directDependents?.length ?? 0;
    const radius = impact.blastRadius;
    const riskLevel = impact.risk?.level ?? "n/a";
    const lensTitle = `RepoGraph · blast radius ${radius} (${directs} direct) · risk ${riskLevel}`;

    return [
      new vscode.CodeLens(anchor, {
        title: lensTitle,
        command: "repograph.showBlastRadius",
        tooltip: impact.risk?.reason ?? "Open the full impact report"
      })
    ];
  }
}

function isSupported(document: vscode.TextDocument): boolean {
  if (document.isUntitled || document.uri.scheme !== "file") {
    return false;
  }
  return ["typescript", "typescriptreact", "javascript", "javascriptreact", "python"].includes(document.languageId);
}

/**
 * Pick a reasonable anchor line for the lens — the first top-level
 * function, class, export, or import declaration. Falls back to line 0
 * so every supported file still gets a lens even when the heuristic
 * misses.
 */
function findAnchor(document: vscode.TextDocument): vscode.Range | null {
  const limit = Math.min(document.lineCount, 200);
  const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|const|let|var|def|import|from)\b/;
  for (let line = 0; line < limit; line += 1) {
    if (declaration.test(document.lineAt(line).text)) {
      return new vscode.Range(line, 0, line, 0);
    }
  }
  return new vscode.Range(0, 0, 0, 0);
}
