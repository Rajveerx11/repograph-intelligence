import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  analyzeRepository,
  analyzeSecurityRisk,
  analyzeSupplyChain,
  compressContext,
  createAgentContext,
  loadGraph,
  recommendArchitecture,
  saveGraph,
  scoreDependencyRisk,
  summarizeRepository
} from "../../packages/core/src/index.js";
import { startWatch } from "../../packages/core/src/watch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const webDir = __dirname;
const graphPath = path.join(rootDir, ".repograph", "graph.json");
const contextPath = path.join(rootDir, ".repograph", "context.md");
const agentContextPath = path.join(rootDir, ".repograph", "agent-context.json");
const maxApiBodyBytes = 64 * 1024;
const maxTextInputLength = 2000;
const port = sanitizePort(process.env.PORT, 5173);
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`
]);
const allowedHosts = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`
]);

const vite = await createViteServer({
  appType: "spa",
  root: webDir,
  server: {
    hmr: { server: null },
    middlewareMode: true
  }
});

const sseClients = new Set();
const watchEnabled = process.env.REPOGRAPH_WATCH !== "0";
let stopWatcher = null;
let lastGraphSnapshot = null;

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/api/events") {
      handleSse(request, response);
      return;
    }
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    vite.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(response, 500, {
      error: "Unexpected server error."
    });
  }
});

server.listen(port, "127.0.0.1", async () => {
  console.log(`RepoGraph web app: http://127.0.0.1:${port}`);
  if (watchEnabled) {
    stopWatcher = await startWatch(rootDir, {
      outputPath: graphPath,
      onUpdate: (event) => {
        if (event.type === "ready" || event.type === "updated") {
          lastGraphSnapshot = {
            generatedAt: new Date().toISOString(),
            metrics: event.metrics,
            durationMs: event.durationMs ?? 0,
            changedFiles: event.changedFiles ?? 0
          };
          broadcastSse("graph-updated", lastGraphSnapshot);
        }
        if (event.type === "error") {
          broadcastSse("watch-error", { message: event.error.message });
        }
      }
    }).catch((error) => {
      console.error("watch failed to start:", error.message);
      return null;
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopWatcher) {
      await stopWatcher();
    }
    server.close(() => process.exit(0));
  });
}

function handleSse(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  if (!isTrustedHost(request)) {
    sendJson(response, 403, { error: "Untrusted request host." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");
  if (lastGraphSnapshot) {
    response.write(`event: graph-updated\ndata: ${JSON.stringify(lastGraphSnapshot)}\n\n`);
  }
  const heartbeat = setInterval(() => {
    response.write(": ping\n\n");
  }, 25000);
  const client = { response, heartbeat };
  sseClients.add(client);
  request.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
}

function broadcastSse(eventName, payload) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.response.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function handleApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!isTrustedHost(request)) {
    sendJson(response, 403, { error: "Untrusted request host." });
    return;
  }

  if (!isTrustedOrigin(request)) {
    sendJson(response, 403, { error: "Untrusted request origin." });
    return;
  }

  if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
    sendJson(response, 403, { error: "Cross-site request blocked." });
    return;
  }

  const body = await readRequestJson(request, maxApiBodyBytes);

  if (request.url === "/api/analyze") {
    const graph = await analyzeRepository(rootDir);
    await saveGraph(graph, graphPath);
    sendJson(response, 200, {
      title: "Repository analyzed",
      message: "Graph saved to the local .repograph workspace.",
      graph,
      payload: summarizeRepository(graph)
    });
    return;
  }

  if (request.url === "/api/action") {
    const graph = await getGraph();
    const result = await runAction(graph, body);
    sendJson(response, 200, result);
    return;
  }

  sendJson(response, 404, { error: "Unknown API route." });
}

async function runAction(graph, body) {
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "explain") {
    return {
      title: "Architecture explained",
      message: "Generated a repository architecture summary.",
      payload: summarizeRepository(graph)
    };
  }

  if (action === "context") {
    const context = compressContext(graph);
    await writeText(contextPath, context);
    return {
      title: "AI context generated",
      message: "Saved compressed AI context to the local .repograph workspace.",
      payload: context
    };
  }

  if (action === "agent-context") {
    const context = createAgentContext(graph, {
      query: sanitizeText(body.query),
      changedFiles: parseCsv(body.changed),
      limit: 8
    });
    await writeText(agentContextPath, `${JSON.stringify(context, null, 2)}\n`);
    return {
      title: "Agent context generated",
      message: "Saved structured AI agent context to the local .repograph workspace.",
      payload: context
    };
  }

  if (action === "risk") {
    return {
      title: "Dependency risk ranked",
      message: "Showing the highest-risk files by coupling and dependency pressure.",
      payload: scoreDependencyRisk(graph).slice(0, 12)
    };
  }

  if (action === "security") {
    return {
      title: "Security surfaces checked",
      message: "Found security-sensitive architecture signals.",
      payload: analyzeSecurityRisk(graph, { limit: 12 })
    };
  }

  if (action === "recommend") {
    return {
      title: "Recommendations generated",
      message: "Generated architecture improvement recommendations.",
      payload: recommendArchitecture(graph, { limit: 12 })
    };
  }

  if (action === "supply-chain") {
    const report = await analyzeSupplyChain(rootDir, { online: body.online === true });
    return {
      title: "Supply chain audited",
      message: report.summary,
      payload: report
    };
  }

  throw new Error("Unknown action.");
}

async function getGraph() {
  try {
    return await loadGraph(graphPath);
  } catch {
    const graph = await analyzeRepository(rootDir);
    await saveGraph(graph, graphPath);
    return graph;
  }
}

async function readRequestJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function parseCsv(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .slice(0, maxTextInputLength)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxTextInputLength);
}

function isTrustedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    const referer = request.headers.referer;
    if (!referer) {
      return true;
    }
    try {
      const refererOrigin = new URL(referer).origin;
      return allowedOrigins.has(refererOrigin);
    } catch {
      return false;
    }
  }
  return allowedOrigins.has(origin);
}

function isTrustedHost(request) {
  const host = request.headers.host;
  return typeof host === "string" && allowedHosts.has(host);
}

function sanitizePort(value, fallback) {
  const portNumber = Number(value ?? fallback);
  if (!Number.isInteger(portNumber) || portNumber < 1024 || portNumber > 65535) {
    return fallback;
  }
  return portNumber;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
