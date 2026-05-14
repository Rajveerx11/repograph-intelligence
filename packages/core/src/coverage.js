import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { scoreDependencyRisk } from "./impact.js";

const DEFAULT_MAX_LCOV_BYTES = 10 * 1024 * 1024;

/**
 * Parse an LCOV "tracefile" string into a structured coverage report.
 *
 * The parser recognises the subset of fields produced by Istanbul, c8,
 * pytest-cov, and jacoco (LF/LH for lines, BRF/BRH for branches,
 * FNF/FNH for functions). Unknown fields are ignored so future LCOV
 * extensions do not break the loader.
 *
 * @param {string} source - Raw LCOV text.
 * @returns {{ files: Array<object>, totals: object }}
 */
export function parseLcov(source) {
  if (typeof source !== "string") {
    throw new Error("parseLcov expects a string LCOV source.");
  }
  const files = [];
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line === "end_of_record") {
      if (current) {
        finalizeRecord(current);
        files.push(current);
        current = null;
      }
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const tag = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    if (tag === "SF") {
      if (current) {
        finalizeRecord(current);
        files.push(current);
      }
      current = createRecord(value.trim());
      continue;
    }
    if (!current) {
      continue;
    }
    if (tag === "LF") {
      current.linesFound = toInt(value);
    } else if (tag === "LH") {
      current.linesHit = toInt(value);
    } else if (tag === "BRF") {
      current.branchesFound = toInt(value);
    } else if (tag === "BRH") {
      current.branchesHit = toInt(value);
    } else if (tag === "FNF") {
      current.functionsFound = toInt(value);
    } else if (tag === "FNH") {
      current.functionsHit = toInt(value);
    }
  }
  if (current) {
    finalizeRecord(current);
    files.push(current);
  }
  return { files, totals: aggregateTotals(files) };
}

/**
 * Load an LCOV file from disk with a bounded size check, then parse it.
 *
 * @param {string} lcovPath
 * @param {object} [options]
 * @param {number} [options.maxBytes]
 * @returns {Promise<object>} Parsed coverage report.
 */
export async function loadLcov(lcovPath, options = {}) {
  const absolutePath = path.resolve(lcovPath);
  const maxBytes = boundedInt(options.maxBytes, DEFAULT_MAX_LCOV_BYTES, 1, 200 * 1024 * 1024);
  const info = await stat(absolutePath);
  if (!info.isFile()) {
    throw new Error("LCOV path must point to a file.");
  }
  if (info.size > maxBytes) {
    throw new Error(`LCOV file exceeds maximum size of ${maxBytes} bytes.`);
  }
  const source = await readFile(absolutePath, "utf8");
  return parseLcov(source);
}

/**
 * Attach coverage data to file nodes of a graph. Returns a new graph
 * with `coverage` populated on each file node (or `null` if no match),
 * plus a report describing which entries matched and which did not.
 *
 * Path matching tries, in order:
 *   1. Exact match after slash + leading-dot normalization
 *   2. Coverage path is a suffix of the graph path
 *   3. Graph path is a suffix of the coverage path
 *   4. Basename match (marked `weakMatch: true` so callers can warn)
 *
 * @param {object} graph
 * @param {object} coverageReport - Output of `parseLcov` or `loadLcov`.
 * @param {object} [options]
 * @param {boolean} [options.allowBasenameMatch=true]
 * @returns {{ graph: object, matchReport: object }}
 */
export function applyCoverageToGraph(graph, coverageReport, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("applyCoverageToGraph requires a graph with nodes and edges arrays.");
  }
  if (!coverageReport || !Array.isArray(coverageReport.files)) {
    throw new Error("applyCoverageToGraph requires a coverageReport with a files array.");
  }
  const allowBasenameMatch = options.allowBasenameMatch !== false;

  const entries = coverageReport.files
    .filter((entry) => entry.path)
    .map((entry) => ({
      entry,
      normalized: normalizePath(entry.path),
      basename: path.basename(entry.path)
    }));

  const matched = new Set();
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "file") {
      return node;
    }
    const graphPath = normalizePath(node.path ?? "");
    if (!graphPath) {
      return { ...node, coverage: null };
    }
    let match = entries.find((candidate) => candidate.normalized === graphPath);
    let weakMatch = false;
    if (!match) {
      match = entries.find((candidate) => graphPath.endsWith(`/${candidate.normalized}`) || candidate.normalized.endsWith(`/${graphPath}`));
    }
    if (!match && allowBasenameMatch) {
      const candidates = entries.filter((candidate) => candidate.basename === path.basename(graphPath));
      if (candidates.length === 1) {
        match = candidates[0];
        weakMatch = true;
      }
    }
    if (!match) {
      return { ...node, coverage: null };
    }
    matched.add(match.entry.path);
    const coverage = {
      linesFound: match.entry.linesFound,
      linesHit: match.entry.linesHit,
      lineCoverage: percent(match.entry.linesHit, match.entry.linesFound),
      branchesFound: match.entry.branchesFound,
      branchesHit: match.entry.branchesHit,
      branchCoverage: percent(match.entry.branchesHit, match.entry.branchesFound),
      functionsFound: match.entry.functionsFound,
      functionsHit: match.entry.functionsHit,
      functionCoverage: percent(match.entry.functionsHit, match.entry.functionsFound)
    };
    if (weakMatch) {
      coverage.weakMatch = true;
    }
    return { ...node, coverage };
  });

  const matchReport = {
    matched: matched.size,
    unmatchedCoverage: coverageReport.files.length - matched.size,
    unmatchedGraph: nodes.filter((node) => node.type === "file" && !node.coverage).length,
    coverageFiles: coverageReport.files.length,
    totals: coverageReport.totals
  };

  return {
    graph: { ...graph, nodes },
    matchReport
  };
}

/**
 * Combine dependency risk score with coverage to produce a prioritized
 * list of high-risk, low-coverage files — the ones an LLM-assisted PR
 * should review first.
 *
 * @param {object} graph
 * @param {object} coverageReport
 * @param {object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.coverageThreshold=80] - Files at or above
 *        this line-coverage percent are excluded from the top of the
 *        ranking; they still appear if explicitly requested via
 *        `options.includeFullyCovered = true`.
 */
export function rankByCoverageRisk(graph, coverageReport, options = {}) {
  const limit = boundedInt(options.limit, 20, 1, 500);
  const threshold = boundedInt(options.coverageThreshold, 80, 0, 100);
  const { graph: enriched, matchReport } = applyCoverageToGraph(graph, coverageReport, options);
  const risks = scoreDependencyRisk(enriched);
  const byPath = new Map();
  for (const file of enriched.nodes) {
    if (file.type === "file" && file.path) {
      byPath.set(file.path, file);
    }
  }

  const rows = [];
  for (const risk of risks) {
    const file = byPath.get(risk.path);
    if (!file) {
      continue;
    }
    const coverage = file.coverage ?? null;
    const lineCoverage = coverage?.lineCoverage ?? null;
    const hasCoverage = lineCoverage !== null;
    if (!options.includeFullyCovered && hasCoverage && lineCoverage >= threshold) {
      continue;
    }
    const priority = computePriority(risk.score, lineCoverage);
    rows.push({
      path: risk.path,
      riskLevel: risk.level,
      riskScore: risk.score,
      lineCoverage,
      branchCoverage: coverage?.branchCoverage ?? null,
      functionCoverage: coverage?.functionCoverage ?? null,
      hasCoverage,
      priority
    });
  }

  rows.sort((left, right) => right.priority - left.priority || left.path.localeCompare(right.path));
  return {
    generatedAt: new Date().toISOString(),
    coverageThreshold: threshold,
    matchReport,
    rows: rows.slice(0, limit)
  };
}

function createRecord(filePath) {
  return {
    path: filePath,
    linesFound: 0,
    linesHit: 0,
    branchesFound: 0,
    branchesHit: 0,
    functionsFound: 0,
    functionsHit: 0
  };
}

function finalizeRecord(record) {
  record.lineCoverage = percent(record.linesHit, record.linesFound);
  record.branchCoverage = percent(record.branchesHit, record.branchesFound);
  record.functionCoverage = percent(record.functionsHit, record.functionsFound);
}

function aggregateTotals(files) {
  const totals = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0, functionsFound: 0, functionsHit: 0 };
  for (const file of files) {
    totals.linesFound += file.linesFound;
    totals.linesHit += file.linesHit;
    totals.branchesFound += file.branchesFound;
    totals.branchesHit += file.branchesHit;
    totals.functionsFound += file.functionsFound;
    totals.functionsHit += file.functionsHit;
  }
  totals.lineCoverage = percent(totals.linesHit, totals.linesFound);
  totals.branchCoverage = percent(totals.branchesHit, totals.branchesFound);
  totals.functionCoverage = percent(totals.functionsHit, totals.functionsFound);
  return totals;
}

function percent(hit, found) {
  if (!found || found <= 0) {
    return null;
  }
  return Math.round((hit / found) * 10000) / 100;
}

function normalizePath(value) {
  const str = String(value ?? "").replace(/\\/g, "/").trim();
  return str.replace(/^\.\//, "");
}

function computePriority(riskScore, lineCoverage) {
  const coverageGap = lineCoverage === null ? 100 : Math.max(0, 100 - lineCoverage);
  return Math.round((riskScore * coverageGap) * 100) / 100;
}

function toInt(value) {
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
