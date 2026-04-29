import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractJavaScriptFacts } from "./extractors/javascript.js";
import { extractPythonFacts } from "./extractors/python.js";
import { buildGraph } from "./graph.js";
import { scanRepository } from "./scanner.js";
import { createSemanticText } from "./semantic.js";

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
      facts.push(withSemanticText(extractJavaScriptFacts(file, source), source));
    } else if (PY_EXTENSIONS.has(extension)) {
      facts.push(withSemanticText(extractPythonFacts(file, source), source));
    }
  }

  return buildGraph({ root, files: facts });
}

function withSemanticText(fileFacts, source) {
  return {
    ...fileFacts,
    lineCount: source.split(/\r?\n/).length,
    semanticText: createSemanticText(fileFacts, source)
  };
}
