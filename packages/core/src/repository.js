import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractJavaScriptFacts } from "./extractors/javascript.js";
import { extractPythonFacts } from "./extractors/python.js";
import { buildGraph } from "./graph.js";
import { scanRepository } from "./scanner.js";

const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const PY_EXTENSIONS = new Set([".py"]);

export async function analyzeRepository(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const files = await scanRepository(root, options);
  const facts = [];

  for (const file of files) {
    const source = await readFile(file.absolutePath, "utf8");
    const extension = path.extname(file.absolutePath).toLowerCase();

    if (JS_EXTENSIONS.has(extension)) {
      facts.push(extractJavaScriptFacts(file, source));
    } else if (PY_EXTENSIONS.has(extension)) {
      facts.push(extractPythonFacts(file, source));
    }
  }

  return buildGraph({ root, files: facts });
}

