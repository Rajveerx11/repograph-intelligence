#!/usr/bin/env node
import path from "node:path";
import { analyzeRepository, calculateMetrics, loadGraph, saveGraph } from "../../core/src/index.js";

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
    positional.push(arg);
  }

  return {
    target: positional[0] ?? ".",
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

Commands:
  analyze  Analyze a repository and save .repograph/graph.json
  graph    Print the normalized structural graph as JSON
  stats    Print repository metrics as JSON
`);
}

