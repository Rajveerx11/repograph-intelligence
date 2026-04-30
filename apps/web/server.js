import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  analyzeRepository,
  analyzeSecurityRisk,
  compressContext,
  createAgentContext,
  loadGraph,
  recommendArchitecture,
  saveGraph,
  scoreDependencyRisk,
  summarizeRepository
} from "../../packages/core/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const webDir = __dirname;
const graphPath = path.join(rootDir, ".repograph", "graph.json");
const contextPath = path.join(rootDir, ".repograph", "context.md");
const agentContextPath = path.join(rootDir, ".repograph", "agent-context.json");
const port = Number(process.env.PORT ?? 5173);

const vite = await createViteServer({
  appType: "spa",
  root: webDir,
  server: {
    hmr: { server: null },
    middlewareMode: true
  }
});

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    vite.middlewares(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error."
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RepoGraph web app: http://127.0.0.1:${port}`);
});

async function handleApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readRequestJson(request);

  if (request.url === "/api/analyze") {
    const graph = await analyzeRepository(rootDir);
    await saveGraph(graph, graphPath);
    sendJson(response, 200, {
      title: "Repository analyzed",
      message: `Graph saved to ${graphPath}`,
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
      message: `Saved compressed AI context to ${contextPath}`,
      payload: context
    };
  }

  if (action === "agent-context") {
    const context = createAgentContext(graph, {
      query: typeof body.query === "string" ? body.query : "",
      changedFiles: parseCsv(body.changed),
      limit: 8
    });
    await writeText(agentContextPath, `${JSON.stringify(context, null, 2)}\n`);
    return {
      title: "Agent context generated",
      message: `Saved structured AI agent context to ${agentContextPath}`,
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

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function parseCsv(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
