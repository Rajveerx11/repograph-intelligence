import { readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_FILES = 20000;

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".repograph",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "venv"
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".ts",
  ".tsx"
]);

export async function scanRepository(root, options = {}) {
  const ignoredDirectories = new Set([
    ...DEFAULT_IGNORED_DIRECTORIES,
    ...(options.ignoredDirectories ?? [])
  ]);
  const maxDepth = boundedNumber(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 512);
  const maxFiles = boundedNumber(options.maxFiles, DEFAULT_MAX_FILES, 1, 100000);
  const files = [];

  async function visit(directory, depth) {
    if (depth > maxDepth) {
      throw new Error(`repository scan exceeded max depth of ${maxDepth}`);
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(absolutePath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      files.push({
        absolutePath,
        relativePath: toGraphPath(path.relative(root, absolutePath)),
        extension
      });

      if (files.length > maxFiles) {
        throw new Error(`repository scan exceeded max file count of ${maxFiles}`);
      }
    }
  }

  await visit(root, 0);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

export function toGraphPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
}
