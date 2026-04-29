#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  analyzeChangedFiles,
  analyzeImpact,
  analyzeRepositories,
  analyzeRepositoryHistory,
  analyzeRepository,
  analyzeSecurityRisk,
  calculateMetrics,
  compareGraphSnapshots,
  compressContext,
  createCiReport,
  createAgentContext,
  createGuidanceReport,
  createGraphSnapshot,
  inferOwnership,
  loadGraph,
  recommendArchitecture,
  saveGraph,
  semanticSearch,
  simulateRefactor,
  scoreDependencyRisk,
  summarizeRepository,
  validateGraph
} from "../../core/src/index.js";

const execFileAsync = promisify(execFile);
const command = process.argv[2];
const args = process.argv.slice(3);

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "analyze") {
    await analyzeCommand(args);
  } else if (command === "graph") {
    await graphCommand(args);
  } else if (command === "stats") {
    await statsCommand(args);
  } else if (command === "search") {
    await searchCommand(args);
  } else if (command === "explain") {
    await explainCommand(args);
  } else if (command === "context") {
    await contextCommand(args);
  } else if (command === "impact") {
    await impactCommand(args);
  } else if (command === "risk") {
    await riskCommand(args);
  } else if (command === "simulate") {
    await simulateCommand(args);
  } else if (command === "diff") {
    await diffCommand(args);
  } else if (command === "guide") {
    await guideCommand(args);
  } else if (command === "agent-context") {
    await agentContextCommand(args);
  } else if (command === "workspace") {
    await workspaceCommand(args);
  } else if (command === "history") {
    await historyCommand(args);
  } else if (command === "ownership") {
    await ownershipCommand(args);
  } else if (command === "security") {
    await securityCommand(args);
  } else if (command === "recommend") {
    await recommendCommand(args);
  } else if (command === "validate") {
    await validateCommand(args);
  } else if (command === "snapshot") {
    await snapshotCommand(args);
  } else if (command === "compare") {
    await compareCommand(args);
  } else if (command === "ci") {
    await ciCommand(args);
  } else if (command === "mcp") {
    await import("../../mcp/src/server.js");
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`repograph: ${error.message}`);
  process.exit(1);
}

async function analyzeCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = await analyzeRepository(target);
  const outputPath = options.out ?? path.join(path.resolve(target), ".repograph", "graph.json");
  const savedPath = await saveGraph(graph, outputPath);
  const metrics = calculateMetrics(graph);

  console.log(`Analyzed ${path.resolve(target)}`);
  console.log(`Graph: ${savedPath}`);
  console.log(`Files: ${metrics.files}`);
  console.log(`Symbols: ${metrics.symbols}`);
  console.log(`Internal dependencies: ${metrics.internalDependencies}`);
  console.log(`External dependencies: ${metrics.externalDependencies}`);
}

async function graphCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);

  console.log(JSON.stringify(graph, null, 2));
}

async function statsCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const metrics = calculateMetrics(graph);

  console.log(JSON.stringify(metrics, null, 2));
}

async function searchCommand(args) {
  const { target, query, options } = parseSearchArgs(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const results = semanticSearch(graph, query, { limit: Number(options.limit ?? 10) });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (!results.length) {
    console.log("No semantic matches found.");
    return;
  }

  for (const result of results) {
    const terms = result.matchedTerms.length ? ` (${result.matchedTerms.join(", ")})` : "";
    console.log(`${result.score.toFixed(4)}  ${result.path}${terms}`);
  }
}

async function explainCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const summary = summarizeRepository(graph);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(summary.overview);
  console.log("");
  console.log(`Files: ${summary.metrics.files}`);
  console.log(`Symbols: ${summary.metrics.symbols}`);
  console.log(`Internal dependencies: ${summary.metrics.internalDependencies}`);
  console.log(`External dependencies: ${summary.metrics.externalDependencies}`);
  console.log(`Hotspots: ${summary.metrics.hotspots.map((item) => item.path).join(", ") || "none"}`);
}

async function contextCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const context = compressContext(graph);

  if (options.out) {
    const outputPath = path.resolve(options.out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, context, "utf8");
    console.log(`Context: ${outputPath}`);
    return;
  }

  console.log(context);
}

async function impactCommand(args) {
  const { target, paths, options } = parsePathCommandArgs(args, "impact");
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const impact = analyzeImpact(graph, paths, { maxDepth: Number(options.depth ?? Infinity) });

  if (options.json) {
    console.log(JSON.stringify(impact, null, 2));
    return;
  }

  console.log(`Changed files: ${impact.changedFiles.join(", ") || "none matched"}`);
  console.log(`Blast radius: ${impact.blastRadius}`);
  console.log(`Risk: ${impact.risk.level} (${impact.risk.reason})`);
  console.log(`Direct dependents: ${impact.directDependents.join(", ") || "none"}`);
  console.log(`Transitive dependents: ${impact.transitiveDependents.map((item) => item.path).join(", ") || "none"}`);
}

async function riskCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const risks = scoreDependencyRisk(graph).slice(0, Number(options.limit ?? 20));

  if (options.json) {
    console.log(JSON.stringify(risks, null, 2));
    return;
  }

  for (const item of risks) {
    console.log(`${String(item.score).padStart(3, " ")}  ${item.level.padEnd(6, " ")}  ${item.path}`);
    console.log(`     ${item.reasons.join("; ")}`);
  }
}

async function simulateCommand(args) {
  const { target, paths, options } = parsePathCommandArgs(args, "simulate");
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const simulation = simulateRefactor(graph, paths, { maxDepth: Number(options.depth ?? Infinity) });

  if (options.json) {
    console.log(JSON.stringify(simulation, null, 2));
    return;
  }

  console.log(`Change set: ${simulation.changeSet.join(", ") || "none matched"}`);
  console.log(`Touched modules: ${simulation.touchedModules.join(", ") || "none"}`);
  console.log(`Risk: ${simulation.risk.level}`);
  console.log(`Blast radius: ${simulation.impact.blastRadius}`);
  console.log("Recommendations:");
  for (const recommendation of simulation.recommendations) {
    console.log(`- ${recommendation}`);
  }
}

async function diffCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const changedFiles = await gitChangedFiles(target, options);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const analysis = analyzeChangedFiles(graph, changedFiles, { maxDepth: Number(options.depth ?? Infinity) });

  if (options.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log(analysis.summary);
  console.log(`Changed files: ${analysis.changedFiles.join(", ") || "none matched in graph"}`);
  console.log(`Recommendations:`);
  for (const recommendation of analysis.recommendations) {
    console.log(`- ${recommendation}`);
  }
}

async function guideCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const changedFiles = options.changed ? options.changed.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const guidance = createGuidanceReport(graph, { changedFiles });

  if (options.json) {
    console.log(JSON.stringify(guidance, null, 2));
    return;
  }

  if (!guidance.warnings.length) {
    console.log("No major structural warnings detected.");
  } else {
    for (const warning of guidance.warnings) {
      const pathLabel = warning.path ? ` ${warning.path}` : "";
      console.log(`${warning.severity.toUpperCase()} ${warning.code}${pathLabel}`);
      console.log(`  ${warning.message}`);
      if (warning.detail) {
        console.log(`  ${warning.detail}`);
      }
    }
  }
  console.log("Recommendations:");
  for (const recommendation of guidance.recommendations) {
    console.log(`- ${recommendation}`);
  }
}

async function agentContextCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const changedFiles = options.changed ? options.changed.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const context = createAgentContext(graph, {
    query: options.query,
    changedFiles,
    limit: Number(options.limit ?? 8)
  });

  if (options.out) {
    const outputPath = path.resolve(options.out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
    console.log(`Agent context: ${outputPath}`);
    return;
  }

  console.log(JSON.stringify(context, null, 2));
}

async function workspaceCommand(args) {
  const { positional, options } = parseTargetAndOptionsWithPositionals(args);
  const repositories = positional.length ? positional : ["."];
  const workspace = await analyzeRepositories(repositories);

  if (options.json) {
    console.log(JSON.stringify(workspace, null, 2));
    return;
  }

  console.log(`Repositories: ${workspace.repositoryCount}`);
  console.log(`Files: ${workspace.totals.files}`);
  console.log(`Symbols: ${workspace.totals.symbols}`);
  console.log(`Internal dependencies: ${workspace.totals.internalDependencies}`);
  console.log(`External dependencies: ${workspace.totals.externalDependencies}`);
  if (workspace.sharedExternalPackages.length) {
    console.log("Shared external packages:");
    for (const item of workspace.sharedExternalPackages) {
      console.log(`- ${item.name}: ${item.repositories} repositories`);
    }
  }
}

async function historyCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const history = await analyzeRepositoryHistory(target, { limit: Number(options.limit ?? 200) });

  if (options.json) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  if (!history.available) {
    console.log(history.reason);
    return;
  }

  console.log(`Commits analyzed: ${history.commitsAnalyzed}`);
  console.log(`Contributors: ${history.contributors.map((item) => item.name).join(", ") || "none"}`);
  console.log("Historical hotspots:");
  for (const file of history.fileHotspots.slice(0, Number(options.limit ?? 10))) {
    console.log(`- ${file.path}: ${file.churn} churn across ${file.commits} commit(s)`);
  }
  console.log("Drift signals:");
  for (const signal of history.driftSignals) {
    console.log(`- ${signal.severity.toUpperCase()} ${signal.message}`);
  }
}

async function ownershipCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const history = await analyzeRepositoryHistory(target, { limit: Number(options.limit ?? 200) });
  const ownership = inferOwnership(graph, history);

  if (options.json) {
    console.log(JSON.stringify(ownership, null, 2));
    return;
  }

  console.log(`Ownership source: ${ownership.available ? "git history" : "repository structure only"}`);
  console.log("Modules:");
  for (const module of ownership.modules.slice(0, Number(options.limit ?? 10))) {
    const owners = module.primaryOwners.map((owner) => `${owner.name} (${owner.files})`).join(", ") || "unassigned";
    console.log(`- ${module.name}: ${module.ownershipCoverage} coverage, owners: ${owners}`);
  }
  console.log("Signals:");
  for (const signal of ownership.signals) {
    console.log(`- ${signal.severity.toUpperCase()} ${signal.message}`);
  }
}

async function securityCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const security = analyzeSecurityRisk(graph, { limit: Number(options.limit ?? 10) });

  if (options.json) {
    console.log(JSON.stringify(security, null, 2));
    return;
  }

  console.log(security.summary);
  console.log("Findings:");
  for (const finding of security.findings.slice(0, Number(options.limit ?? 10))) {
    console.log(`- ${finding.severity.toUpperCase()} ${finding.type}: ${finding.target}`);
    console.log(`  ${finding.message}`);
  }
  console.log("Critical blast zones:");
  for (const zone of security.criticalBlastZones.slice(0, Number(options.limit ?? 10))) {
    console.log(`- ${zone.path}: ${zone.risk}, blast radius ${zone.blastRadius}`);
  }
}

async function recommendCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const recommendations = recommendArchitecture(graph, { limit: Number(options.limit ?? 20) });

  if (options.json) {
    console.log(JSON.stringify(recommendations, null, 2));
    return;
  }

  console.log(recommendations.summary);
  for (const item of recommendations.recommendations) {
    console.log(`- ${item.priority.toUpperCase()} ${item.title}: ${item.target}`);
    console.log(`  ${item.reason}`);
    for (const action of item.actions) {
      console.log(`  * ${action}`);
    }
  }
}

async function validateCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const validation = validateGraph(graph);

  if (options.json) {
    console.log(JSON.stringify(validation, null, 2));
    return;
  }

  console.log(validation.summary);
  for (const error of validation.errors) {
    console.log(`ERROR ${error}`);
  }
  for (const warning of validation.warnings) {
    console.log(`WARN ${warning}`);
  }
}

async function snapshotCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const snapshot = createGraphSnapshot(graph);
  const outputPath = options.out ?? path.join(path.resolve(target), ".repograph", "snapshot.json");

  if (options.json && !options.out) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  await writeJson(outputPath, snapshot);
  console.log(`Snapshot: ${path.resolve(outputPath)}`);
  console.log(snapshot.validation.summary);
  console.log(`Fingerprint: ${snapshot.fingerprint}`);
}

async function compareCommand(args) {
  const { positional, options } = parseTargetAndOptionsWithPositionals(args);
  const basePath = options.base ?? positional[0];
  const headPath = options.head ?? positional[1];

  if (!basePath || !headPath) {
    throw new Error("compare requires --base <snapshot> and --head <snapshot>");
  }

  const comparison = compareGraphSnapshots(await readJson(basePath), await readJson(headPath));

  if (options.json) {
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  console.log(comparison.summary);
  console.log(`Changed: ${comparison.changed}`);
  console.log(`Severity: ${comparison.severity}`);
  console.log(`Added files: ${comparison.files.added.join(", ") || "none"}`);
  console.log(`Removed files: ${comparison.files.removed.join(", ") || "none"}`);
  console.log(`Changed files: ${comparison.files.changed.join(", ") || "none"}`);
}

async function ciCommand(args) {
  const { target, options } = parseTargetAndOptions(args);
  const graph = options.graph
    ? await loadGraph(options.graph)
    : await analyzeRepository(target);
  const baseline = options.baseline ? await readJson(options.baseline) : null;
  const report = createCiReport(graph, {
    baseline,
    failOn: options.failOn ?? "high"
  });

  if (options.out) {
    await writeJson(options.out, report);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.summary);
    for (const finding of report.findings) {
      const targetLabel = finding.target ? ` ${finding.target}` : "";
      console.log(`- ${finding.severity.toUpperCase()} ${finding.type}${targetLabel}`);
      console.log(`  ${finding.message}`);
    }
    if (options.out) {
      console.log(`Report: ${path.resolve(options.out)}`);
    }
  }

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

function parseTargetAndOptions(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      options.out = requireValue(args, index, "--out");
      index += 1;
      continue;
    }
    if (arg === "--graph") {
      options.graph = requireValue(args, index, "--graph");
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = requireValue(args, index, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--depth") {
      options.depth = requireValue(args, index, "--depth");
      index += 1;
      continue;
    }
    if (arg === "--base") {
      options.base = requireValue(args, index, "--base");
      index += 1;
      continue;
    }
    if (arg === "--head") {
      options.head = requireValue(args, index, "--head");
      index += 1;
      continue;
    }
    if (arg === "--query") {
      options.query = requireValue(args, index, "--query");
      index += 1;
      continue;
    }
    if (arg === "--changed") {
      options.changed = requireValue(args, index, "--changed");
      index += 1;
      continue;
    }
    if (arg === "--baseline") {
      options.baseline = requireValue(args, index, "--baseline");
      index += 1;
      continue;
    }
    if (arg === "--fail-on") {
      options.failOn = requireValue(args, index, "--fail-on");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positional.push(arg);
  }

  return {
    target: positional[0] ?? ".",
    options
  };
}

function parsePathCommandArgs(args, commandName) {
  const { positional, options } = parseTargetAndOptionsWithPositionals(args);
  let target = ".";
  let paths = positional;

  if (positional.length > 1 && looksLikeDirectory(positional[0])) {
    target = positional[0];
    paths = positional.slice(1);
  }

  if (!paths.length) {
    throw new Error(`${commandName} requires at least one file path`);
  }

  return { target, paths, options };
}

function parseSearchArgs(args) {
  const { target, options, positional } = parseTargetAndOptionsWithPositionals(args);
  let searchTarget = target;
  let queryParts = positional.slice(1);

  if (positional.length === 1) {
    searchTarget = ".";
    queryParts = positional;
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("search requires a query");
  }

  return {
    target: searchTarget,
    query,
    options
  };
}

function parseTargetAndOptionsWithPositionals(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      options.out = requireValue(args, index, "--out");
      index += 1;
      continue;
    }
    if (arg === "--graph") {
      options.graph = requireValue(args, index, "--graph");
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = requireValue(args, index, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--depth") {
      options.depth = requireValue(args, index, "--depth");
      index += 1;
      continue;
    }
    if (arg === "--base") {
      options.base = requireValue(args, index, "--base");
      index += 1;
      continue;
    }
    if (arg === "--head") {
      options.head = requireValue(args, index, "--head");
      index += 1;
      continue;
    }
    if (arg === "--query") {
      options.query = requireValue(args, index, "--query");
      index += 1;
      continue;
    }
    if (arg === "--changed") {
      options.changed = requireValue(args, index, "--changed");
      index += 1;
      continue;
    }
    if (arg === "--baseline") {
      options.baseline = requireValue(args, index, "--baseline");
      index += 1;
      continue;
    }
    if (arg === "--fail-on") {
      options.failOn = requireValue(args, index, "--fail-on");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    positional.push(arg);
  }

  return {
    target: positional[0] ?? ".",
    positional,
    options
  };
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function looksLikeDirectory(value) {
  if (value === "." || value === "..") {
    return true;
  }
  const absolutePath = path.resolve(value);
  return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
}

async function gitChangedFiles(target, options) {
  const base = options.base ?? "origin/main";
  const head = options.head ?? "HEAD";
  const range = base === head ? head : `${base}...${head}`;
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      path.resolve(target),
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      range
    ]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    throw new Error(`failed to read git diff for ${range}: ${error.message}`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

async function writeJson(filePath, value) {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

function printHelp() {
  console.log(`RepoGraph Intelligence CLI

Usage:
  repograph analyze [repo] [--out path]
  repograph graph [repo] [--graph path]
  repograph stats [repo] [--graph path]
  repograph search [repo] <query> [--limit n] [--json]
  repograph explain [repo] [--graph path] [--json]
  repograph context [repo] [--graph path] [--out path]
  repograph impact [repo] <file...> [--depth n] [--json]
  repograph risk [repo] [--limit n] [--json]
  repograph simulate [repo] <file...> [--depth n] [--json]
  repograph diff [repo] [--base ref] [--head ref] [--json]
  repograph guide [repo] [--changed file,file] [--json]
  repograph agent-context [repo] [--query text] [--changed file,file] [--out path]
  repograph workspace <repo...> [--json]
  repograph history [repo] [--limit n] [--json]
  repograph ownership [repo] [--limit n] [--json]
  repograph security [repo] [--limit n] [--json]
  repograph recommend [repo] [--limit n] [--json]
  repograph validate [repo] [--graph path] [--json]
  repograph snapshot [repo] [--graph path] [--out path] [--json]
  repograph compare --base snapshot.json --head snapshot.json [--json]
  repograph ci [repo] [--baseline snapshot.json] [--fail-on high|medium|low] [--out path] [--json]
  repograph mcp

Commands:
  analyze  Analyze a repository and save .repograph/graph.json
  graph    Print the normalized structural graph as JSON
  stats    Print repository metrics as JSON
  search   Search files by local semantic relevance
  explain  Print an architecture and repository intelligence summary
  context  Print compressed AI-ready repository context
  impact   Show blast radius for changed files
  risk     Rank files by dependency risk
  simulate Simulate structural effects of a change set
  diff     Analyze changed files from a Git diff
  guide    Print structural guidance warnings
  agent-context Generate AI-ready structured repository context
  workspace Analyze multiple repositories together
  history  Analyze repository evolution from Git history
  ownership Infer file and module ownership from Git history
  security Identify security-sensitive architecture risk
  recommend Generate architecture improvement recommendations
  validate Validate graph schema and references
  snapshot Create a stable graph intelligence snapshot
  compare  Compare two graph snapshots
  ci       Produce CI-oriented structural intelligence report
  mcp      Start the RepoGraph MCP stdio server
`);
}
