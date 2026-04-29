#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeRepository,
  calculateMetrics,
  compressContext,
  loadGraph,
  saveGraph,
  semanticSearch,
  summarizeRepository
} from "../../core/src/index.js";

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

function printHelp() {
  console.log(`RepoGraph Intelligence CLI

Usage:
  repograph analyze [repo] [--out path]
  repograph graph [repo] [--graph path]
  repograph stats [repo] [--graph path]
  repograph search [repo] <query> [--limit n] [--json]
  repograph explain [repo] [--graph path] [--json]
  repograph context [repo] [--graph path] [--out path]

Commands:
  analyze  Analyze a repository and save .repograph/graph.json
  graph    Print the normalized structural graph as JSON
  stats    Print repository metrics as JSON
  search   Search files by local semantic relevance
  explain  Print an architecture and repository intelligence summary
  context  Print compressed AI-ready repository context
`);
}
