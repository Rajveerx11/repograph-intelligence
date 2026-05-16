#!/usr/bin/env node
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  analyzeImpact,
  analyzeRepositoryHistory,
  analyzeRepository,
  analyzeSecurityRisk,
  analyzeSupplyChain,
  compareGraphSnapshots,
  createCiReport,
  createAgentContext,
  createGuidanceReport,
  createGraphSnapshot,
  detectDrift,
  inferOwnership,
  applyCoverageToGraph,
  diffApiSurface,
  evaluatePolicy,
  loadPolicy,
  parseLcov,
  rankByCoverageRisk,
  recommendArchitecture,
  selectTests,
  semanticSearch,
  summarizeRepository,
  toDot,
  toMermaid,
  validatePolicy,
  validateGraph
} from "../../core/src/index.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const allowedRoots = parseAllowedRoots(process.env.REPOGRAPH_ALLOWED_ROOTS ?? process.cwd());

const tools = [
  {
    name: "repograph_analyze",
    description: "Analyze a repository and return a structural intelligence summary.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_search",
    description: "Search repository files using local semantic relevance.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" }
      },
      required: ["repoPath", "query"]
    }
  },
  {
    name: "repograph_context",
    description: "Return AI-ready repository context with architecture, metrics, guidance, and optional query matches.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        query: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_impact",
    description: "Estimate blast radius for changed files.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["repoPath", "changedFiles"]
    }
  },
  {
    name: "repograph_guidance",
    description: "Return structural warnings and recommendations for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_history",
    description: "Analyze repository evolution and historical churn from Git history.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_ownership",
    description: "Infer file and module ownership from Git history.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_security",
    description: "Identify security-sensitive architecture risk and critical blast zones.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_recommend",
    description: "Generate architecture improvement recommendations from graph intelligence.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_validate",
    description: "Validate graph schema and edge/node references for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_snapshot",
    description: "Create a stable graph intelligence snapshot for baseline comparison.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_compare",
    description: "Compare two graph snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        baseSnapshot: { type: "object" },
        headSnapshot: { type: "object" }
      },
      required: ["baseSnapshot", "headSnapshot"]
    }
  },
  {
    name: "repograph_supply_chain",
    description: "Audit dependency manifests, license risk, and optional OSV advisories.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        online: { type: "boolean", description: "Query OSV.dev for vulnerability advisories." }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_test_select",
    description: "Select the minimum set of test files that exercise a list of changed files. Walks the graph in reverse (callers → callees) from each changed file and filters dependents to test paths.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Paths of files that changed in the diff (repo-relative)."
        },
        testPatterns: {
          type: "array",
          items: { type: "string" },
          description: "Optional glob patterns identifying test files. Defaults cover common JS/TS/Python/Go conventions."
        },
        maxDepth: { type: "number", description: "Cap on the reverse-walk depth (1-100)." }
      },
      required: ["repoPath", "changedFiles"]
    }
  },
  {
    name: "repograph_coverage",
    description: "Overlay LCOV test coverage onto the repository graph and optionally rank files by combined risk and low coverage. The LCOV payload is passed inline; the MCP JSON-RPC envelope caps requests at 1 MB, so for larger tracefiles use the `repograph coverage` CLI which reads from disk with a 10 MB default cap.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." },
        lcov: { type: "string", description: "Raw LCOV tracefile content (capped by the 1 MB MCP envelope)." },
        rank: { type: "boolean", description: "Return a ranked list combining risk score with inverse coverage." },
        limit: { type: "number", description: "Maximum rows in the ranking (1-500)." },
        coverageThreshold: { type: "number", description: "Files at or above this line-coverage percent (0-100) are excluded from the ranking." }
      },
      required: ["repoPath", "lcov"]
    }
  },
  {
    name: "repograph_drift",
    description: "Compare a baseline graph or snapshot against the current state and flag drift (new cycles, new dependencies, density spikes, etc.) using per-metric thresholds.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze for the head state. Skipped if `headGraph` is provided." },
        baselineSnapshot: { type: "object", description: "Previously saved graph snapshot." },
        baselineGraph: { type: "object", description: "Alternative to baselineSnapshot — pass a raw graph to snapshot inline." },
        headGraph: { type: "object", description: "Override the head graph (skips analysis)." },
        thresholds: {
          type: "object",
          description: "Per-metric drift caps. Unspecified metrics default to Infinity (uncapped) except `maxNewCycles` which defaults to 0.",
          properties: {
            maxNewCycles: { type: "number" },
            maxAddedFiles: { type: "number" },
            maxRemovedFiles: { type: "number" },
            maxInternalDepIncrease: { type: "number" },
            maxExternalDepIncrease: { type: "number" },
            maxDensityIncrease: { type: "number" },
            maxNewExternalPackages: { type: "number" }
          }
        }
      }
    }
  },
  {
    name: "repograph_api_diff",
    description: "Compare two RepoGraph snapshots and report added, removed, and changed public-API exports. Useful for PR reviews and release-notes generation.",
    inputSchema: {
      type: "object",
      properties: {
        baseGraph: { type: "object", description: "Baseline graph (RepoGraph JSON) — the 'before' state." },
        headGraph: { type: "object", description: "Head graph (RepoGraph JSON) — the 'after' state." }
      },
      required: ["baseGraph", "headGraph"]
    }
  },
  {
    name: "repograph_policy",
    description: "Evaluate architecture rules (forbid-import, forbid-dependency, no-cycles, max-imports, max-lines) against the repository graph and return a pass/fail report.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." },
        policyPath: { type: "string", description: "Path to a .json policy file." },
        policy: { type: "object", description: "Inline policy object (alternative to policyPath)." },
        failOn: {
          type: "string",
          description: "Lowest severity that causes the report to fail.",
          enum: ["info", "warning", "error"]
        }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_dot",
    description: "Export the repository dependency graph as GraphViz DOT source. Renderable by Graphviz dot/neato/twopi, Gephi, yEd, and any tool that consumes DOT.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." },
        rankdir: {
          type: "string",
          description: "Layout rank direction. `TD` is accepted as an alias for GraphViz `TB`.",
          enum: ["LR", "TB", "TD", "RL", "BT"]
        },
        includeSymbols: { type: "boolean" },
        includePackages: { type: "boolean" },
        includeContains: { type: "boolean" },
        maxNodes: { type: "number", description: "Cap on rendered nodes (1-5000, default 200)." },
        maxEdges: { type: "number", description: "Cap on rendered edges (1-20000, default 400)." }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_mermaid",
    description: "Export the repository dependency graph as a Mermaid flowchart that renders inline in Markdown.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Repository path to analyze." },
        direction: {
          type: "string",
          description: "Flowchart layout direction.",
          enum: ["LR", "TD", "TB", "RL", "BT"]
        },
        includeSymbols: { type: "boolean", description: "Include function, class, method, interface, and module nodes." },
        includePackages: { type: "boolean", description: "Include external package nodes (default true)." },
        includeContains: { type: "boolean", description: "Render contains edges (file -> symbol)." },
        maxNodes: { type: "number", description: "Cap on rendered nodes (1-5000, default 200)." },
        maxEdges: { type: "number", description: "Cap on rendered edges (1-20000, default 400)." }
      },
      required: ["repoPath"]
    }
  },
  {
    name: "repograph_ci",
    description: "Create a CI-oriented structural intelligence report.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        baselineSnapshot: { type: "object" },
        failOn: { type: "string" }
      },
      required: ["repoPath"]
    }
  }
];

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer, "utf8") > MAX_MESSAGE_BYTES) {
    buffer = "";
    sendError(null, -32700, "Message exceeds maximum size.");
    return;
  }

  drainMessages().catch((error) => {
    buffer = "";
    sendError(null, -32700, error.message);
  });
});

async function drainMessages() {
  while (buffer.length) {
    if (buffer.startsWith("Content-Length:")) {
      const framed = readFramedMessage();
      if (!framed) {
        return;
      }
      await handleParsedMessage(framed);
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) {
      return;
    }
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      await handleParsedMessage(line);
    }
  }
}

async function handleParsedMessage(source) {
  try {
    await handleMessage(parseJsonMessage(source));
  } catch (error) {
    sendError(null, -32700, error.message);
  }
}

function readFramedMessage() {
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator === -1) {
    return null;
  }
  const header = buffer.slice(0, separator);
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error("Missing Content-Length header");
  }
  const length = Number(match[1]);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error("Invalid Content-Length header");
  }
  if (length > MAX_MESSAGE_BYTES) {
    throw new Error("Message exceeds maximum size.");
  }
  const start = separator + 4;
  const end = start + length;
  if (buffer.length < end) {
    return null;
  }
  const message = buffer.slice(start, end);
  buffer = buffer.slice(end);
  return message;
}

async function handleMessage(message) {
  try {
    if (!message || typeof message !== "object") {
      sendError(null, -32600, "Invalid JSON-RPC message.");
      return;
    }

    if (message.method === "initialize") {
      sendResponse(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "repograph-intelligence", version: "0.1.0" }
      });
      return;
    }

    if (message.method === "tools/list") {
      sendResponse(message.id, { tools });
      return;
    }

    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      sendResponse(message.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
      return;
    }

    if (message.id !== undefined) {
      sendResponse(message.id, {});
    }
  } catch (error) {
    sendError(message.id, -32000, error.message);
  }
}

async function callTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object.");
  }

  if (name === "repograph_analyze") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return summarizeRepository(graph);
  }
  if (name === "repograph_search") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return semanticSearch(graph, requireString(args.query, "query"), { limit: boundedLimit(args.limit) });
  }
  if (name === "repograph_context") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return createAgentContext(graph, {
      query: optionalString(args.query, "query"),
      changedFiles: stringArray(args.changedFiles, "changedFiles")
    });
  }
  if (name === "repograph_impact") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return analyzeImpact(graph, stringArray(args.changedFiles, "changedFiles"));
  }
  if (name === "repograph_guidance") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return createGuidanceReport(graph, { changedFiles: stringArray(args.changedFiles, "changedFiles") });
  }
  if (name === "repograph_history") {
    return analyzeRepositoryHistory(requireRepoPath(args), { limit: boundedLimit(args.limit, 200, 5000) });
  }
  if (name === "repograph_ownership") {
    const repoPath = requireRepoPath(args);
    const graph = await analyzeRepository(repoPath);
    const history = await analyzeRepositoryHistory(repoPath, { limit: boundedLimit(args.limit, 200, 5000) });
    return inferOwnership(graph, history);
  }
  if (name === "repograph_security") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return analyzeSecurityRisk(graph, { limit: boundedLimit(args.limit) });
  }
  if (name === "repograph_recommend") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return recommendArchitecture(graph, { limit: boundedLimit(args.limit, 20) });
  }
  if (name === "repograph_validate") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return validateGraph(graph);
  }
  if (name === "repograph_snapshot") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return createGraphSnapshot(graph);
  }
  if (name === "repograph_compare") {
    return compareGraphSnapshots(requireObject(args.baseSnapshot, "baseSnapshot"), requireObject(args.headSnapshot, "headSnapshot"));
  }
  if (name === "repograph_supply_chain") {
    return analyzeSupplyChain(requireRepoPath(args), {
      online: args.online === true
    });
  }
  if (name === "repograph_drift") {
    if (!args.baselineSnapshot && !args.baselineGraph) {
      throw new Error("repograph_drift requires either baselineSnapshot or baselineGraph.");
    }
    if (args.baselineSnapshot && args.baselineGraph) {
      throw new Error("repograph_drift accepts only one of baselineSnapshot or baselineGraph.");
    }
    const baseInput = args.baselineSnapshot
      ? requireObject(args.baselineSnapshot, "baselineSnapshot")
      : requireObject(args.baselineGraph, "baselineGraph");

    let headGraph;
    if (args.headGraph !== undefined) {
      headGraph = requireObject(args.headGraph, "headGraph");
    } else {
      headGraph = await analyzeRepository(requireRepoPath(args));
    }

    const thresholds = args.thresholds === undefined ? undefined : requireObject(args.thresholds, "thresholds");
    return detectDrift(baseInput, headGraph, { thresholds });
  }
  if (name === "repograph_api_diff") {
    const baseGraph = requireObject(args.baseGraph, "baseGraph");
    const headGraph = requireObject(args.headGraph, "headGraph");
    return diffApiSurface(baseGraph, headGraph);
  }
  if (name === "repograph_test_select") {
    const graph = await analyzeRepository(requireRepoPath(args));
    const changedFiles = stringArray(args.changedFiles, "changedFiles");
    if (!changedFiles.length) {
      throw new Error("changedFiles must contain at least one path.");
    }
    const testPatterns = args.testPatterns === undefined ? undefined : stringArray(args.testPatterns, "testPatterns");
    const maxDepth = args.maxDepth === undefined ? undefined : boundedLimit(args.maxDepth, 50, 100);
    return selectTests(graph, changedFiles, { testPatterns, maxDepth });
  }
  if (name === "repograph_coverage") {
    const graph = await analyzeRepository(requireRepoPath(args));
    const lcovText = requireString(args.lcov, "lcov");
    // The MCP transport already enforces MAX_MESSAGE_BYTES on the JSON-RPC
    // envelope (1 MB by default) so any in-message payload size check here
    // would be unreachable. Agents that need to overlay coverage from a
    // larger tracefile should call the CLI (`repograph coverage --lcov`)
    // which uses the disk loader with a 10 MB default cap.
    const coverageReport = parseLcov(lcovText);
    if (args.rank === true) {
      return rankByCoverageRisk(graph, coverageReport, {
        limit: boundedLimit(args.limit, 20, 500),
        coverageThreshold: boundedLimit(args.coverageThreshold, 80, 100)
      });
    }
    const { graph: enriched, matchReport } = applyCoverageToGraph(graph, coverageReport);
    return {
      matchReport,
      files: enriched.nodes
        .filter((node) => node.type === "file")
        .map((node) => ({ path: node.path, coverage: node.coverage }))
    };
  }
  if (name === "repograph_policy") {
    const graph = await analyzeRepository(requireRepoPath(args));
    if (!args.policy && !args.policyPath) {
      throw new Error("repograph_policy requires either 'policy' or 'policyPath'.");
    }
    if (args.policy && args.policyPath) {
      throw new Error("repograph_policy accepts only one of 'policy' or 'policyPath'.");
    }
    const policy = args.policyPath
      ? await loadPolicy(requireString(args.policyPath, "policyPath"))
      : validatePolicy(args.policy);
    const failOn = optionalSeverityTier(args.failOn);
    return evaluatePolicy(graph, policy, { failOn });
  }
  if (name === "repograph_dot") {
    const graph = await analyzeRepository(requireRepoPath(args));
    const rankdir = optionalRankdir(args.rankdir);
    const options = {
      rankdir,
      includeSymbols: args.includeSymbols === true,
      includePackages: args.includePackages !== false,
      includeContains: args.includeContains === true,
      maxNodes: boundedLimit(args.maxNodes, 200, 5000),
      maxEdges: boundedLimit(args.maxEdges, 400, 20000)
    };
    return {
      dot: toDot(graph, options),
      options: {
        rankdir: options.rankdir ?? "LR",
        includeSymbols: options.includeSymbols,
        includePackages: options.includePackages,
        includeContains: options.includeContains,
        maxNodes: options.maxNodes,
        maxEdges: options.maxEdges
      }
    };
  }
  if (name === "repograph_mermaid") {
    const graph = await analyzeRepository(requireRepoPath(args));
    const direction = optionalDirection(args.direction);
    const options = {
      direction,
      includeSymbols: args.includeSymbols === true,
      includePackages: args.includePackages !== false,
      includeContains: args.includeContains === true,
      maxNodes: boundedLimit(args.maxNodes, 200, 5000),
      maxEdges: boundedLimit(args.maxEdges, 400, 20000)
    };
    return {
      mermaid: toMermaid(graph, options),
      options: {
        direction: options.direction ?? "LR",
        includeSymbols: options.includeSymbols,
        includePackages: options.includePackages,
        includeContains: options.includeContains,
        maxNodes: options.maxNodes,
        maxEdges: options.maxEdges
      }
    };
  }
  if (name === "repograph_ci") {
    const graph = await analyzeRepository(requireRepoPath(args));
    return createCiReport(graph, {
      baseline: optionalObject(args.baselineSnapshot, "baselineSnapshot"),
      failOn: optionalSeverity(args.failOn)
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function parseJsonMessage(source) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Invalid JSON message.");
  }
}

function requireRepoPath(args) {
  const repoPath = requireString(args.repoPath, "repoPath");
  const resolvedPath = resolveAllowedDirectory(repoPath);
  if (!resolvedPath) {
    throw new Error("repoPath must be an existing directory inside an allowed workspace.");
  }
  return resolvedPath;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value, name) {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, name);
}

function stringArray(value, name) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function optionalObject(value, name) {
  if (value === undefined) {
    return undefined;
  }
  return requireObject(value, name);
}

function optionalSeverityTier(value) {
  if (value === undefined) {
    return "error";
  }
  if (!["info", "warning", "error"].includes(value)) {
    throw new Error("failOn must be info, warning, or error.");
  }
  return value;
}

function optionalRankdir(value) {
  if (value === undefined) {
    return undefined;
  }
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if (!["LR", "TB", "TD", "RL", "BT"].includes(upper)) {
    throw new Error("rankdir must be one of LR, TB, TD, RL, BT.");
  }
  // Mirror the normalisation `toDot` applies internally so the response
  // metadata never disagrees with the rendered DOT output (e.g. user
  // requests `TD`, DOT emits `rankdir=TB`, response should say `TB` too).
  return upper === "TD" ? "TB" : upper;
}

function optionalDirection(value) {
  if (value === undefined) {
    return undefined;
  }
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if (!["LR", "TD", "TB", "RL", "BT"].includes(upper)) {
    throw new Error("direction must be one of LR, TD, TB, RL, BT.");
  }
  return upper;
}

function optionalSeverity(value) {
  if (value === undefined) {
    return "high";
  }
  if (!["high", "medium", "low"].includes(value)) {
    throw new Error("failOn must be high, medium, or low.");
  }
  return value;
}

function boundedLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(number)));
}

function sendResponse(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function parseAllowedRoots(value) {
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => safeRealpath(entry))
    .filter(Boolean);
}

function resolveAllowedDirectory(repoPath) {
  const realRepoPath = safeRealpath(repoPath);
  if (!realRepoPath) {
    return null;
  }
  try {
    if (!statSync(realRepoPath).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  return allowedRoots.some((root) => isPathInside(realRepoPath, root)) ? realRepoPath : null;
}

function safeRealpath(filePath) {
  try {
    return realpathSync(path.resolve(filePath));
  } catch {
    return null;
  }
}

function isPathInside(candidate, root) {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
