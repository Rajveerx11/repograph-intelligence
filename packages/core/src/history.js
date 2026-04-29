import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function analyzeRepositoryHistory(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const limit = Number(options.limit ?? 200);

  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      root,
      "log",
      `--max-count=${limit}`,
      "--date=short",
      "--numstat",
      "--pretty=format:--RG-COMMIT--%H%x09%ad%x09%an%x09%s"
    ]);

    return summarizeEvolution(parseGitLog(stdout), { root, limit });
  } catch (error) {
    return {
      available: false,
      root,
      reason: `Git history unavailable: ${error.message}`,
      commitsAnalyzed: 0,
      contributors: [],
      fileHotspots: [],
      moduleChurn: [],
      monthlyTrend: [],
      driftSignals: []
    };
  }
}

export function summarizeEvolution(commits, options = {}) {
  const files = new Map();
  const modules = new Map();
  const contributors = new Map();
  const months = new Map();

  for (const commit of commits) {
    incrementContributor(contributors, commit.author, {
      commits: 1,
      additions: 0,
      deletions: 0
    });

    const month = commit.date.slice(0, 7) || "unknown";
    const monthEntry = ensureMapEntry(months, month, {
      month,
      commits: 0,
      additions: 0,
      deletions: 0,
      filesChanged: new Set()
    });
    monthEntry.commits += 1;

    for (const change of commit.files) {
      const fileEntry = ensureMapEntry(files, change.path, {
        path: change.path,
        commits: 0,
        additions: 0,
        deletions: 0,
        lastChanged: commit.date,
        contributors: new Map()
      });
      fileEntry.commits += 1;
      fileEntry.additions += change.additions;
      fileEntry.deletions += change.deletions;
      fileEntry.lastChanged = latestDate(fileEntry.lastChanged, commit.date);
      incrementContributor(fileEntry.contributors, commit.author, {
        commits: 1,
        additions: change.additions,
        deletions: change.deletions
      });

      const moduleName = moduleFromPath(change.path);
      const moduleEntry = ensureMapEntry(modules, moduleName, {
        name: moduleName,
        commits: 0,
        additions: 0,
        deletions: 0,
        filesChanged: new Set(),
        contributors: new Map()
      });
      moduleEntry.commits += 1;
      moduleEntry.additions += change.additions;
      moduleEntry.deletions += change.deletions;
      moduleEntry.filesChanged.add(change.path);
      incrementContributor(moduleEntry.contributors, commit.author, {
        commits: 1,
        additions: change.additions,
        deletions: change.deletions
      });

      const contributorEntry = contributors.get(commit.author);
      contributorEntry.additions += change.additions;
      contributorEntry.deletions += change.deletions;

      monthEntry.additions += change.additions;
      monthEntry.deletions += change.deletions;
      monthEntry.filesChanged.add(change.path);
    }
  }

  const fileHotspots = Array.from(files.values())
    .map((file) => ({
      path: file.path,
      commits: file.commits,
      additions: file.additions,
      deletions: file.deletions,
      churn: file.additions + file.deletions,
      lastChanged: file.lastChanged,
      owners: topContributors(file.contributors, 3)
    }))
    .sort((left, right) => right.churn - left.churn || right.commits - left.commits || left.path.localeCompare(right.path));

  const moduleChurn = Array.from(modules.values())
    .map((module) => ({
      name: module.name,
      commits: module.commits,
      additions: module.additions,
      deletions: module.deletions,
      churn: module.additions + module.deletions,
      filesChanged: module.filesChanged.size,
      owners: topContributors(module.contributors, 3)
    }))
    .sort((left, right) => right.churn - left.churn || left.name.localeCompare(right.name));

  const monthlyTrend = Array.from(months.values())
    .map((month) => ({
      month: month.month,
      commits: month.commits,
      additions: month.additions,
      deletions: month.deletions,
      churn: month.additions + month.deletions,
      filesChanged: month.filesChanged.size
    }))
    .sort((left, right) => left.month.localeCompare(right.month));

  return {
    available: true,
    root: options.root,
    commitsAnalyzed: commits.length,
    contributors: topContributors(contributors, 20),
    fileHotspots: fileHotspots.slice(0, options.fileLimit ?? 20),
    moduleChurn: moduleChurn.slice(0, options.moduleLimit ?? 20),
    monthlyTrend,
    driftSignals: driftSignals(fileHotspots, moduleChurn)
  };
}

function parseGitLog(stdout) {
  const commits = [];
  let current = null;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("--RG-COMMIT--")) {
      const [hash, date, author, ...subjectParts] = line.replace("--RG-COMMIT--", "").split("\t");
      current = {
        hash,
        date: date || "unknown",
        author: author || "unknown",
        subject: subjectParts.join("\t"),
        files: []
      };
      commits.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const [added, deleted, changedPath] = line.split("\t");
    if (!changedPath) {
      continue;
    }
    current.files.push({
      path: normalizePath(changedPath),
      additions: numericStat(added),
      deletions: numericStat(deleted)
    });
  }

  return commits;
}

function driftSignals(fileHotspots, moduleChurn) {
  const signals = [];
  const largeFiles = fileHotspots.filter((file) => file.churn >= 500).slice(0, 5);
  const concentratedModules = moduleChurn.filter((module) => module.filesChanged >= 5 && module.churn >= 1000).slice(0, 5);

  for (const file of largeFiles) {
    signals.push({
      type: "volatile_file",
      severity: file.churn >= 2000 ? "high" : "medium",
      target: file.path,
      message: `${file.path} has high historical churn (${file.churn} changed line(s)).`
    });
  }

  for (const module of concentratedModules) {
    signals.push({
      type: "volatile_module",
      severity: module.churn >= 3000 ? "high" : "medium",
      target: module.name,
      message: `${module.name} changes frequently across ${module.filesChanged} file(s).`
    });
  }

  if (!signals.length && fileHotspots.length) {
    signals.push({
      type: "stable_history",
      severity: "low",
      target: fileHotspots[0].path,
      message: "No major churn concentration detected in the analyzed history window."
    });
  }

  return signals;
}

function topContributors(contributors, limit) {
  return Array.from(contributors.entries())
    .map(([name, stats]) => ({
      name,
      commits: stats.commits,
      additions: stats.additions,
      deletions: stats.deletions,
      churn: stats.additions + stats.deletions
    }))
    .sort((left, right) => right.commits - left.commits || right.churn - left.churn || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function incrementContributor(map, name, delta) {
  const entry = ensureMapEntry(map, name || "unknown", {
    commits: 0,
    additions: 0,
    deletions: 0
  });
  entry.commits += delta.commits;
  entry.additions += delta.additions;
  entry.deletions += delta.deletions;
}

function ensureMapEntry(map, key, fallback) {
  if (!map.has(key)) {
    map.set(key, fallback);
  }
  return map.get(key);
}

function latestDate(left, right) {
  if (!left || left === "unknown") {
    return right;
  }
  if (!right || right === "unknown") {
    return left;
  }
  return left > right ? left : right;
}

function numericStat(value) {
  return /^\d+$/.test(value) ? Number(value) : 0;
}

function moduleFromPath(filePath) {
  return filePath.includes("/") ? filePath.split("/")[0] : ".";
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}
