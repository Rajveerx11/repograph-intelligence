export function inferOwnership(graph, history = null) {
  const files = graph.nodes.filter((node) => node.type === "file");
  const historyByFile = new Map((history?.fileHotspots ?? []).map((file) => [file.path, file]));
  const fileOwnership = files.map((file) => ownershipForFile(file, historyByFile.get(file.path)));
  const moduleOwnership = summarizeModuleOwnership(fileOwnership);

  return {
    available: Boolean(history?.available && history.fileHotspots?.length),
    files: fileOwnership,
    modules: moduleOwnership,
    contributors: history?.contributors ?? [],
    signals: ownershipSignals(fileOwnership, moduleOwnership)
  };
}

function ownershipForFile(file, history) {
  const owners = history?.owners ?? [];
  const primaryOwner = owners[0]?.name ?? "unassigned";
  const shared = owners.length > 1;

  return {
    path: file.path,
    module: moduleFromPath(file.path),
    language: file.language,
    primaryOwner,
    owners,
    shared,
    confidence: confidenceForOwners(owners),
    churn: history?.churn ?? 0,
    commits: history?.commits ?? 0,
    lastChanged: history?.lastChanged ?? null
  };
}

function summarizeModuleOwnership(files) {
  const modules = new Map();
  for (const file of files) {
    if (!modules.has(file.module)) {
      modules.set(file.module, {
        name: file.module,
        files: 0,
        ownedFiles: 0,
        ownerCounts: new Map(),
        churn: 0
      });
    }

    const module = modules.get(file.module);
    module.files += 1;
    module.churn += file.churn;
    if (file.primaryOwner !== "unassigned") {
      module.ownedFiles += 1;
      module.ownerCounts.set(file.primaryOwner, (module.ownerCounts.get(file.primaryOwner) ?? 0) + 1);
    }
  }

  return Array.from(modules.values())
    .map((module) => ({
      name: module.name,
      files: module.files,
      ownedFiles: module.ownedFiles,
      ownershipCoverage: module.files ? Number((module.ownedFiles / module.files).toFixed(2)) : 0,
      primaryOwners: Array.from(module.ownerCounts.entries())
        .map(([name, files]) => ({ name, files }))
        .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name))
        .slice(0, 3),
      churn: module.churn
    }))
    .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name));
}

function ownershipSignals(files, modules) {
  const signals = [];
  const unownedHighChurn = files.filter((file) => file.primaryOwner === "unassigned" && file.churn >= 100).slice(0, 5);
  const lowCoverageModules = modules.filter((module) => module.ownershipCoverage < 0.5 && module.files >= 2).slice(0, 5);
  const singleOwnerModules = modules.filter((module) => module.primaryOwners.length === 1 && module.files >= 4).slice(0, 5);

  for (const file of unownedHighChurn) {
    signals.push({
      type: "unowned_hotspot",
      severity: "medium",
      target: file.path,
      message: `${file.path} changes often but has no inferred owner.`
    });
  }

  for (const module of lowCoverageModules) {
    signals.push({
      type: "low_module_coverage",
      severity: "medium",
      target: module.name,
      message: `${module.name} has ownership coverage of ${module.ownershipCoverage}.`
    });
  }

  for (const module of singleOwnerModules) {
    signals.push({
      type: "single_owner_concentration",
      severity: "low",
      target: module.name,
      message: `${module.name} is concentrated around ${module.primaryOwners[0].name}.`
    });
  }

  if (!signals.length) {
    signals.push({
      type: "ownership_baseline",
      severity: "low",
      target: "repository",
      message: "No major ownership concentration signals detected."
    });
  }

  return signals;
}

function confidenceForOwners(owners) {
  if (!owners.length) {
    return 0;
  }

  const totalCommits = owners.reduce((sum, owner) => sum + owner.commits, 0);
  if (!totalCommits) {
    return 0.25;
  }

  return Number(Math.min(0.95, owners[0].commits / totalCommits).toFixed(2));
}

function moduleFromPath(filePath) {
  return filePath.includes("/") ? filePath.split("/")[0] : ".";
}
