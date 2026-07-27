import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Thin helper that spawns an MCP server subprocess, connects, exposes
 * `callTool`, and cleans up on close. Designed for short-lived ingest
 * runs — not a long-running connection pool.
 */
export class McpSession {
  private client: Client;
  private transport: StdioClientTransport;
  private closed = false;

  private constructor(client: Client, transport: StdioClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  static async open(name: string, spec: McpServerSpec): Promise<McpSession> {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...process.env, ...(spec.env ?? {}) } as Record<string, string>,
    });
    const client = new Client({ name: `now-next-later-${name}`, version: "0.1.0" }, {
      capabilities: {},
    });
    await client.connect(transport);
    return new McpSession(client, transport);
  }

  async listTools(): Promise<string[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => t.name);
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.client.callTool({ name, arguments: args });
    // The MCP tool response is a content array. We try to parse the first
    // text block as JSON; adapters can also read res directly if needed.
    const first = (res.content as Array<{ type: string; text?: string }> | undefined)?.[0];
    if (first?.type === "text" && first.text) {
      try {
        return JSON.parse(first.text) as T;
      } catch {
        return first.text as unknown as T;
      }
    }
    return res as unknown as T;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
  }
}
