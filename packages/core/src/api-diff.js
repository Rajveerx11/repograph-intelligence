/**
 * Compute the public-API surface diff between two RepoGraph snapshots.
 *
 * An "API surface" entry is a single exported symbol identified by
 * `(filePath, exportedName)`. The diff classifies each entry as
 * - `added`   : present in head, absent in base
 * - `removed` : present in base, absent in head
 * - `changed` : present in both but the underlying symbol kind differs
 *               (function -> class, method -> function, etc.)
 *
 * The current graph schema does not record parameter or return-type
 * signatures, so "changed" only fires on a node-`type` mismatch. The
 * report shape is forward-compatible with richer signature info added
 * later: extra fields appended to entries do not break the contract.
 *
 * @param {object} baseGraph
 * @param {object} headGraph
 * @param {object} [options]
 * @param {boolean} [options.includeFileSummary=true]
 * @returns {object}
 */
export function diffApiSurface(baseGraph, headGraph, options = {}) {
  const baseSurface = collectApiSurface(baseGraph, "baseGraph");
  const headSurface = collectApiSurface(headGraph, "headGraph");
  const includeFileSummary = options.includeFileSummary !== false;

  const baseKeys = new Set(baseSurface.entries.keys());
  const headKeys = new Set(headSurface.entries.keys());

  const added = [];
  const removed = [];
  const changed = [];

  for (const key of headKeys) {
    if (!baseKeys.has(key)) {
      const entry = headSurface.entries.get(key);
      added.push({ path: entry.path, name: entry.name, type: entry.type });
      continue;
    }
    const baseEntry = baseSurface.entries.get(key);
    const headEntry = headSurface.entries.get(key);
    if (baseEntry.type !== headEntry.type) {
      changed.push({
        path: headEntry.path,
        name: headEntry.name,
        baseType: baseEntry.type,
        headType: headEntry.type
      });
    }
  }

  for (const key of baseKeys) {
    if (!headKeys.has(key)) {
      const entry = baseSurface.entries.get(key);
      removed.push({ path: entry.path, name: entry.name, type: entry.type });
    }
  }

  sortByPathAndName(added);
  sortByPathAndName(removed);
  sortByPathAndName(changed);

  const baseFilePaths = new Set(baseSurface.files);
  const headFilePaths = new Set(headSurface.files);
  const addedFiles = [...headFilePaths].filter((path) => !baseFilePaths.has(path)).sort();
  const removedFiles = [...baseFilePaths].filter((path) => !headFilePaths.has(path)).sort();

  const summary = {
    baseFiles: baseFilePaths.size,
    headFiles: headFilePaths.size,
    baseExports: baseSurface.entries.size,
    headExports: headSurface.entries.size,
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    addedFiles: addedFiles.length,
    removedFiles: removedFiles.length,
    breaking: removed.length + changed.length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    added,
    removed,
    changed,
    addedFiles,
    removedFiles
  };

  if (includeFileSummary) {
    report.byFile = groupByFile(added, removed, changed);
  }

  return report;
}

/**
 * Collect every exported symbol from a graph into a Map keyed by
 * `${path}::${exportedName}`. The map lets the diff run in O(n + m).
 *
 * @param {object} graph
 * @param {string} label - For error messages.
 */
function collectApiSurface(graph, label) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`${label} must be a RepoGraph with nodes and edges arrays.`);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const filesWithExports = new Set();
  const entries = new Map();

  for (const edge of graph.edges) {
    if (edge.type !== "exports") {
      continue;
    }
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || fromNode.type !== "file") {
      continue;
    }
    const rawName = typeof edge.exportedName === "string" && edge.exportedName.trim()
      ? edge.exportedName.trim()
      : typeof toNode?.label === "string"
        ? toNode.label.trim()
        : "";
    if (!rawName) {
      continue;
    }
    const rawPath = (typeof fromNode.path === "string" && fromNode.path.trim())
      || (typeof fromNode.label === "string" && fromNode.label.trim())
      || "";
    if (!rawPath) {
      continue;
    }
    const symbolType = toNode?.type ?? "unknown";
    const key = `${rawPath}::${rawName}`;
    if (entries.has(key)) {
      const existing = entries.get(key);
      if (existing.type !== symbolType) {
        // Two edges export the same name from the same file with different
        // symbol kinds. Keep the first deterministically but mark the entry
        // so downstream consumers (and tests) can see the conflict.
        existing.conflict = true;
      }
      continue;
    }
    entries.set(key, { path: rawPath, name: rawName, type: symbolType });
    filesWithExports.add(rawPath);
  }

  return { entries, files: filesWithExports };
}

function groupByFile(added, removed, changed) {
  const byFile = new Map();
  const append = (entry, bucket) => {
    if (!byFile.has(entry.path)) {
      byFile.set(entry.path, { path: entry.path, added: [], removed: [], changed: [] });
    }
    byFile.get(entry.path)[bucket].push(entry);
  };
  for (const entry of added) append(entry, "added");
  for (const entry of removed) append(entry, "removed");
  for (const entry of changed) append(entry, "changed");
  return [...byFile.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function sortByPathAndName(entries) {
  entries.sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }
    return left.name.localeCompare(right.name);
  });
}
