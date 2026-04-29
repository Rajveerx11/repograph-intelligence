#!/usr/bin/env node
import {
  analyzeImpact,
  analyzeRepositoryHistory,
  analyzeRepository,
  analyzeSecurityRisk,
  compareGraphSnapshots,
  createCiReport,
  createAgentContext,
  createGuidanceReport,
  createGraphSnapshot,
  inferOwnership,
  recommendArchitecture,
  semanticSearch,
  summarizeRepository,
  validateGraph
} from "../../core/src/index.js";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

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
  return requireString(args.repoPath, "repoPath");
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
