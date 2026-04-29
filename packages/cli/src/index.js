#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  analyzeChangedFiles,
  analyzeImpact,
  analyzeRepositories,
  analyzeRepository,
  calculateMetrics,
  compressContext,
  createAgentContext,
  createGuidanceReport,
  loadGraph,
  saveGraph,
  semanticSearch,
  simulateRefactor,
  scoreDependencyRisk,
  summarizeRepository
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
  mcp      Start the RepoGraph MCP stdio server
`);
}
