import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { extractJavaScriptFacts } from "./extractors/javascript.js";
import { extractPythonFacts } from "./extractors/python.js";
import { buildGraph } from "./graph.js";
import { scanRepository } from "./scanner.js";
import { createSemanticText } from "./semantic.js";

const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const PY_EXTENSIONS = new Set([".py"]);
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function analyzeRepository(repoPath, options = {}) {
  const root = await resolveRepositoryRoot(repoPath);
  const files = await scanRepository(root, options);
  const facts = [];
  const maxFileBytes = boundedNumber(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1024, 25 * 1024 * 1024);

  for (const file of files) {
    const source = await readBoundedFile(file.absolutePath, maxFileBytes);
    if (source === null) {
      continue;
    }
    const extension = path.extname(file.absolutePath).toLowerCase();

    if (JS_EXTENSIONS.has(extension)) {
      facts.push(withSemanticText(extractJavaScriptFacts(file, source), source));
    } else if (PY_EXTENSIONS.has(extension)) {
      facts.push(withSemanticText(extractPythonFacts(file, source), source));
    }
  }

  return buildGraph({ root, files: facts });
}

async function readBoundedFile(absolutePath, maxBytes) {
  const handle = await open(absolutePath, "r");
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > maxBytes) {
      return null;
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function resolveRepositoryRoot(repoPath) {
  const root = await realpath(path.resolve(repoPath));
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("Repository path must point to a directory.");
  }
  return root;
}

function withSemanticText(fileFacts, source) {
  return {
    ...fileFacts,
    lineCount: source.split(/\r?\n/).length,
    semanticText: createSemanticText(fileFacts, source)
  };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
}
