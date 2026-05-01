import { watch } from "node:fs";
import path from "node:path";
import { calculateMetrics } from "./metrics.js";
import { analyzeRepository } from "./repository.js";
import { saveGraph } from "./storage.js";

const DEFAULT_DEBOUNCE_MS = 350;
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);
const IGNORED_SEGMENTS = new Set([
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

export async function startWatch(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  const outputPath = options.outputPath ?? path.join(root, ".repograph", "graph.json");
  const debounceMs = boundedNumber(options.debounceMs, DEFAULT_DEBOUNCE_MS, 50, 60000);
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};

  let stopped = false;
  let pending = new Set();
  let timer = null;
  let running = false;
  let queued = false;

  async function rebuild(reason) {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const start = Date.now();
    const changedFiles = pending.size;
    pending = new Set();
    try {
      const graph = await analyzeRepository(root);
      await saveGraph(graph, outputPath);
      const metrics = calculateMetrics(graph);
      const event = {
        type: reason === "initial" ? "ready" : "updated",
        root,
        outputPath,
        changedFiles,
        durationMs: Date.now() - start,
        metrics,
        graph
      };
      onUpdate(event);
    } catch (error) {
      onUpdate({ type: "error", root, error });
    } finally {
      running = false;
      if (queued && !stopped) {
        queued = false;
        scheduleRebuild();
      }
    }
  }

  function scheduleRebuild() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      rebuild("change");
    }, debounceMs);
  }

  function shouldIgnore(relativePath) {
    if (!relativePath) {
      return true;
    }
    const segments = relativePath.split(/[/\\]/);
    if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) {
      return true;
    }
    const extension = path.extname(relativePath).toLowerCase();
    if (!extension) {
      return true;
    }
    return !SUPPORTED_EXTENSIONS.has(extension);
  }

  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename || stopped) {
        return;
      }
      const relative = String(filename);
      if (shouldIgnore(relative)) {
        return;
      }
      pending.add(relative);
      scheduleRebuild();
    });
  } catch (error) {
    onUpdate({ type: "error", root, error });
  }

  if (watcher) {
    watcher.on("error", (error) => {
      onUpdate({ type: "error", root, error });
    });
  }

  await rebuild("initial");

  return async function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      watcher.close();
    }
  };
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
}
