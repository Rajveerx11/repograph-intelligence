import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveGraph(graph, outputPath) {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  return absolutePath;
}

export async function loadGraph(graphPath) {
  const source = await readFile(path.resolve(graphPath), "utf8");
  return JSON.parse(source);
}

