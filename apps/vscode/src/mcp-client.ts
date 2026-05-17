import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024; // 8 MB hard cap on a single response.
const REQUEST_TIMEOUT_MS = 60_000; // Bounded request lifetime — agent must not hang.

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpClientOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Override the default 60 s request timeout for slow operations. */
  requestTimeoutMs?: number;
}

/**
 * Stdio JSON-RPC client for the RepoGraph MCP server.
 *
 * Handles both newline-delimited and `Content-Length`-framed messages so
 * the same client speaks to the canonical RepoGraph MCP server (line-
 * delimited) and to any future LSP-style framed transport without code
 * changes. Inbound buffer is hard-capped at 8 MB to prevent a runaway
 * subprocess from exhausting the extension host's memory.
 *
 * The client is intentionally minimal — it only implements `initialize`,
 * `tools/list`, and `tools/call`, which is everything the extension uses.
 */
export class McpClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly options: McpClientOptions;
  private startPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  /** Idempotent — multiple callers can await the same boot. */
  start(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("MCP client has been disposed."));
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.spawnProcess();
    return this.startPromise;
  }

  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, [...this.options.args], {
        cwd: this.options.cwd,
        env: { ...process.env, ...(this.options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"]
      });

      child.on("error", (error) => {
        this.failPending(error);
        reject(error);
      });

      child.on("exit", (code, signal) => {
        const reason = `MCP server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
        this.failPending(new Error(reason));
        this.process = null;
        this.startPromise = null;
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onData(chunk));

      // Keep stderr available for diagnostics but don't fail the boot on
      // chatter — the canonical server writes Vite-style noise occasionally.
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", () => undefined);

      this.process = child;

      // Send the JSON-RPC initialize handshake. The server's response
      // confirms the protocol version we negotiated.
      this.send({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "repograph-vscode", version: "0.4.0" }
        }
      })
        .then(() => resolve())
        .catch(reject);
    });
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{ name: string; description: string }>;
    };
    return result.tools ?? [];
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    if (result.isError) {
      const message = result.content?.map((entry) => entry.text ?? "").join("\n") ?? "MCP tool returned an error.";
      throw new Error(message);
    }
    const text = result.content?.map((entry) => entry.text ?? "").join("\n") ?? "";
    if (!text) {
      return undefined as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Tools that legitimately return non-JSON text (e.g. raw Mermaid)
      // are passed through as-is rather than coerced to JSON.
      return text as unknown as T;
    }
  }

  dispose(): void {
    this.closed = true;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.failPending(new Error("MCP client disposed."));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    const timeout = this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out after ${timeout} ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send(message).catch((error) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private send(message: unknown): Promise<void> {
    if (!this.process) {
      return Promise.reject(new Error("MCP server is not running."));
    }
    const payload = `${JSON.stringify(message)}\n`;
    return new Promise((resolve, reject) => {
      this.process!.stdin.write(payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_MESSAGE_BYTES) {
      const error = new Error("MCP response exceeded 8 MB buffer cap.");
      this.failPending(error);
      this.buffer = "";
      return;
    }
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length > 0) {
      if (this.buffer.startsWith("Content-Length:")) {
        const framed = this.takeFramed();
        if (!framed) {
          return;
        }
        this.dispatch(framed);
        continue;
      }
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        this.dispatch(line);
      }
    }
  }

  private takeFramed(): string | null {
    const separator = this.buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return null;
    }
    const header = this.buffer.slice(0, separator);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Malformed frame; advance past the bad header instead of looping.
      this.buffer = this.buffer.slice(separator + 4);
      return null;
    }
    const length = Number(match[1]);
    const start = separator + 4;
    const end = start + length;
    if (this.buffer.length < end) {
      return null;
    }
    const body = this.buffer.slice(start, end);
    this.buffer = this.buffer.slice(end);
    return body;
  }

  private dispatch(payload: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } } | null = null;
    try {
      message = JSON.parse(payload);
    } catch {
      // Tolerate stray non-JSON noise from the subprocess.
      return;
    }
    if (!message || typeof message !== "object" || typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "MCP error response"));
      return;
    }
    pending.resolve(message.result);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
