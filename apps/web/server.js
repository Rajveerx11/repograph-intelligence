import { createServer } from "node:http";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
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
const webDir = __dirname;

let rootDir = path.resolve(__dirname, "../..");
let graphPath = path.join(rootDir, ".repograph", "graph.json");
let contextPath = path.join(rootDir, ".repograph", "context.md");
let agentContextPath = path.join(rootDir, ".repograph", "agent-context.json");
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

const allowedRoots = (process.env.REPOGRAPH_ALLOWED_ROOTS ?? "")
  .split(",")
  .map((root) => root.trim())
  .filter(Boolean)
  .map((root) => path.resolve(root));

function setProjectRoot(newRoot) {
  rootDir = newRoot;
  graphPath = path.join(rootDir, ".repograph", "graph.json");
  contextPath = path.join(rootDir, ".repograph", "context.md");
  agentContextPath = path.join(rootDir, ".repograph", "agent-context.json");
}

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
let setRootInFlight = false;

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

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
  if (!isTrustedHost(request)) {
    sendJson(response, 403, { error: "Untrusted request host." });
    return;
  }

  if (request.url === "/api/root" && request.method === "GET") {
    sendJson(response, 200, { root: rootDir });
    return;
  }

  if (request.url === "/api/graph" && request.method === "GET") {
    try {
      const graph = await loadGraph(graphPath);
      sendJson(response, 200, { graph });
    } catch {
      sendJson(response, 404, { error: "No graph available yet. Run analyze first." });
    }
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
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

  if (request.url === "/api/set-root") {
    if (setRootInFlight) {
      sendJson(response, 429, { error: "Another set-root is in progress. Try again shortly." });
      return;
    }
    const newRoot = typeof body.root === "string" ? body.root.trim() : "";
    if (!newRoot) {
      sendJson(response, 400, { error: "Missing root path." });
      return;
    }
    if (newRoot.length > 4096 || newRoot.includes("\0")) {
      sendJson(response, 400, { error: "Invalid root path." });
      return;
    }
    let resolved;
    try {
      resolved = await realpath(path.resolve(newRoot));
    } catch {
      sendJson(response, 400, { error: "Directory does not exist." });
      return;
    }
    if (allowedRoots.length > 0 && !allowedRoots.some((allowed) => isPathInside(resolved, allowed))) {
      sendJson(response, 403, { error: "Path is outside allowed roots." });
      return;
    }
    try {
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        sendJson(response, 400, { error: "Path is not a directory." });
        return;
      }
    } catch {
      sendJson(response, 400, { error: "Directory does not exist." });
      return;
    }
    setRootInFlight = true;
    let graph = null;
    let analyzeError = null;
    try {
      setProjectRoot(resolved);
      if (stopWatcher) {
        try { await stopWatcher(); } catch {}
        stopWatcher = null;
      }
      lastGraphSnapshot = null;
      try {
        graph = await analyzeRepository(rootDir);
        await saveGraph(graph, graphPath);
      } catch (error) {
        analyzeError = error instanceof Error ? error.message : "Failed to analyze project.";
      }
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
    } finally {
      setRootInFlight = false;
    }
    sendJson(response, 200, {
      root: resolved,
      message: analyzeError
        ? `Project root updated, but analysis failed: ${analyzeError}`
        : "Project root updated and analyzed.",
      graph,
      analyzeError
    });
    return;
  }

  if (request.url === "/api/analyze") {
    const graph = await analyzeRepository(rootDir);
    await saveGraph(graph, graphPath);
    sendJson(response, 200, {
      title: "Repository analyzed",
      message: "Graph saved to the local .repograph workspace.",
      graph,
      payload: summarizeRepository(graph),
      formattedText: compressContext(graph)
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
      payload: summarizeRepository(graph),
      formattedText: compressContext(graph)
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
    const risks = scoreDependencyRisk(graph).slice(0, 12);
    return {
      title: "Dependency risk ranked",
      message: "Showing the highest-risk files by coupling and dependency pressure.",
      payload: risks,
      formattedText: formatRiskAsText(risks)
    };
  }

  if (action === "security") {
    const security = analyzeSecurityRisk(graph, { limit: 12 });
    return {
      title: "Security surfaces checked",
      message: "Found security-sensitive architecture signals.",
      payload: security,
      formattedText: formatSecurityAsText(security)
    };
  }

  if (action === "recommend") {
    const recs = recommendArchitecture(graph, { limit: 12 });
    return {
      title: "Recommendations generated",
      message: "Generated architecture improvement recommendations.",
      payload: recs,
      formattedText: formatRecommendationsAsText(recs)
    };
  }

  if (action === "supply-chain") {
    const report = await analyzeSupplyChain(rootDir, { online: body.online === true });
    return {
      title: "Supply chain audited",
      message: report.summary,
      payload: report,
      formattedText: formatSupplyChainAsText(report)
    };
  }

  throw new Error("Unknown action.");
}

function formatRiskAsText(risks) {
  if (!risks.length) {
    return "No high-risk files detected.";
  }
  const lines = ["# Dependency Risk Rankings", ""];
  for (const [index, risk] of risks.entries()) {
    lines.push(`${index + 1}. ${risk.path} — risk: ${risk.level} (score ${risk.score})`);
    lines.push(`   Incoming: ${risk.incoming}, Outgoing: ${risk.outgoing}, External: ${risk.externalDependencies}`);
    if (risk.reasons?.length) {
      lines.push(`   Reasons: ${risk.reasons.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatSecurityAsText(security) {
  const lines = ["# Security Analysis", "", security.summary, ""];
  if (security.findings?.length) {
    lines.push("## Findings", "");
    for (const finding of security.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.message}`);
      if (finding.target) {
        lines.push(`  Target: ${finding.target}`);
      }
    }
    lines.push("");
  }
  if (security.criticalBlastZones?.length) {
    lines.push("## Critical Blast Zones", "");
    for (const zone of security.criticalBlastZones) {
      lines.push(`- ${zone.path} — risk: ${zone.risk}, blast radius: ${zone.blastRadius} file(s)`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatRecommendationsAsText(recs) {
  if (!recs.length) {
    return "No recommendations at this time.";
  }
  const lines = ["# Architecture Recommendations", ""];
  for (const [index, rec] of recs.entries()) {
    lines.push(`${index + 1}. [${rec.priority.toUpperCase()}] ${rec.title}`);
    lines.push(`   Target: ${rec.target}`);
    lines.push(`   Reason: ${rec.reason}`);
    if (rec.actions?.length) {
      for (const action of rec.actions) {
        lines.push(`   - ${action}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatSupplyChainAsText(report) {
  const lines = ["# Supply Chain Audit", "", report.summary, ""];
  if (report.manifests?.length) {
    lines.push(`Manifests scanned: ${report.manifests.length}`);
    for (const manifest of report.manifests) {
      lines.push(`  - ${manifest.path}: ${manifest.dependencies?.length ?? 0} dependencies`);
    }
    lines.push("");
  }
  if (report.licenses?.length) {
    lines.push("## Licenses", "");
    for (const license of report.licenses) {
      lines.push(`- ${license.name}: ${license.license ?? "unknown"} (${license.risk ?? "unknown"})`);
    }
    lines.push("");
  }
  if (report.advisories?.length) {
    lines.push("## Advisories", "");
    for (const advisory of report.advisories) {
      lines.push(`- ${advisory.package}: ${advisory.title ?? advisory.summary ?? "advisory"} (${advisory.severity ?? "unknown"})`);
    }
    lines.push("");
  }
  return lines.join("\n");
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
