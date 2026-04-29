#!/usr/bin/env node
import {
  analyzeImpact,
  analyzeRepositoryHistory,
  analyzeRepository,
  analyzeSecurityRisk,
  createAgentContext,
  createGuidanceReport,
  inferOwnership,
  recommendArchitecture,
  semanticSearch,
  summarizeRepository
} from "../../core/src/index.js";

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
  }
];

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  await drainMessages();
});

async function drainMessages() {
  while (buffer.length) {
    const framed = readFramedMessage();
    if (!framed) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        await handleMessage(JSON.parse(line));
      }
      continue;
    }
    await handleMessage(JSON.parse(framed));
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
  if (name === "repograph_analyze") {
    const graph = await analyzeRepository(args.repoPath);
    return summarizeRepository(graph);
  }
  if (name === "repograph_search") {
    const graph = await analyzeRepository(args.repoPath);
    return semanticSearch(graph, args.query, { limit: args.limit ?? 10 });
  }
  if (name === "repograph_context") {
    const graph = await analyzeRepository(args.repoPath);
    return createAgentContext(graph, {
      query: args.query,
      changedFiles: args.changedFiles ?? []
    });
  }
  if (name === "repograph_impact") {
    const graph = await analyzeRepository(args.repoPath);
    return analyzeImpact(graph, args.changedFiles ?? []);
  }
  if (name === "repograph_guidance") {
    const graph = await analyzeRepository(args.repoPath);
    return createGuidanceReport(graph, { changedFiles: args.changedFiles ?? [] });
  }
  if (name === "repograph_history") {
    return analyzeRepositoryHistory(args.repoPath, { limit: args.limit ?? 200 });
  }
  if (name === "repograph_ownership") {
    const graph = await analyzeRepository(args.repoPath);
    const history = await analyzeRepositoryHistory(args.repoPath, { limit: args.limit ?? 200 });
    return inferOwnership(graph, history);
  }
  if (name === "repograph_security") {
    const graph = await analyzeRepository(args.repoPath);
    return analyzeSecurityRisk(graph, { limit: args.limit ?? 10 });
  }
  if (name === "repograph_recommend") {
    const graph = await analyzeRepository(args.repoPath);
    return recommendArchitecture(graph, { limit: args.limit ?? 20 });
  }
  throw new Error(`Unknown tool: ${name}`);
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
