import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpClient } from "../src/mcp-client.js";

// A miniature mock MCP server written in pure Node so we can drive the
// client end-to-end without touching the real RepoGraph CLI. The mock
// honours the initialize handshake and answers `tools/list` plus a
// configurable `tools/call`.
const MOCK_SERVER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } }) + "\\n");
    } else if (message.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "mock", description: "Mock" }] } }) + "\\n");
    } else if (message.method === "tools/call") {
      const args = message.params?.arguments ?? {};
      if (args.fail === true) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "boom" } }) + "\\n");
      } else if (args.payload === "string") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "raw text response" }] } }) + "\\n");
      } else {
        const payload = JSON.stringify({ echo: args });
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: payload }] } }) + "\\n");
      }
    }
  }
});
`;

function withMockServer(): { script: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-mock-"));
  const script = path.join(dir, "mock.mjs");
  writeFileSync(script, MOCK_SERVER, "utf8");
  return { script, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("McpClient performs the initialize handshake and lists tools", async () => {
  const { script, cleanup } = withMockServer();
  const client = new McpClient({ command: process.execPath, args: [script] });
  try {
    await client.start();
    const tools = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "mock");
  } finally {
    client.dispose();
    cleanup();
  }
});

test("McpClient parses JSON tool results back into objects", async () => {
  const { script, cleanup } = withMockServer();
  const client = new McpClient({ command: process.execPath, args: [script] });
  try {
    await client.start();
    const result = (await client.callTool("mock", { foo: 1, bar: "baz" })) as { echo?: { foo: number; bar: string } };
    assert.deepEqual(result.echo, { foo: 1, bar: "baz" });
  } finally {
    client.dispose();
    cleanup();
  }
});

test("McpClient passes through non-JSON tool text unchanged", async () => {
  const { script, cleanup } = withMockServer();
  const client = new McpClient({ command: process.execPath, args: [script] });
  try {
    await client.start();
    const result = await client.callTool("mock", { payload: "string" });
    assert.equal(result, "raw text response");
  } finally {
    client.dispose();
    cleanup();
  }
});

test("McpClient surfaces JSON-RPC error responses as rejected promises", async () => {
  const { script, cleanup } = withMockServer();
  const client = new McpClient({ command: process.execPath, args: [script] });
  try {
    await client.start();
    await assert.rejects(() => client.callTool("mock", { fail: true }), /boom/);
  } finally {
    client.dispose();
    cleanup();
  }
});

test("McpClient times out a request whose response never arrives", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-silent-"));
  const script = path.join(dir, "silent.mjs");
  // Server that answers initialize but ignores tools/call.
  writeFileSync(
    script,
    `let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n");
    }
  }
});`,
    "utf8"
  );
  const client = new McpClient({ command: process.execPath, args: [script], requestTimeoutMs: 200 });
  try {
    await client.start();
    await assert.rejects(() => client.callTool("mock", {}), /timed out/);
  } finally {
    client.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
