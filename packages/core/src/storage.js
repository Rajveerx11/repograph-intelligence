import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_GRAPH_BYTES = 25 * 1024 * 1024;

export async function saveGraph(graph, outputPath) {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return absolutePath;
}

export async function loadGraph(graphPath, options = {}) {
  const absolutePath = path.resolve(graphPath);
  const maxBytes = boundedNumber(options.maxBytes, DEFAULT_MAX_GRAPH_BYTES, 1, 100 * 1024 * 1024);
  const graphStat = await stat(absolutePath);

  if (!graphStat.isFile()) {
    throw new Error("Graph path must point to a file.");
  }
  if (graphStat.size > maxBytes) {
    throw new Error(`Graph file exceeds maximum size of ${maxBytes} bytes.`);
  }

  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
}
