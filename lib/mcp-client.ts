import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpStdioSpec {
  kind: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpHttpSpec {
  kind: "http";
  url: string;
  /** Optional bearer token for authenticated MCP servers (Fellow, etc.). */
  bearerToken?: string;
}

export type McpServerSpec = McpStdioSpec | McpHttpSpec;

/**
 * Thin helper that opens an MCP session (stdio subprocess or HTTP), exposes
 * `callTool` / `listTools`, and cleans up on close. Designed for short-lived
 * ingest runs — not a long-running connection pool.
 */
export class McpSession {
  private client: Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transport: any;
  private closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(client: Client, transport: any) {
    this.client = client;
    this.transport = transport;
  }

  static async open(name: string, spec: McpServerSpec): Promise<McpSession> {
    const client = new Client(
      { name: `now-next-later-${name}`, version: "0.1.0" },
      { capabilities: {} },
    );
    if (spec.kind === "http") {
      const opts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};
      if (spec.bearerToken) {
        opts.requestInit = {
          headers: { authorization: `Bearer ${spec.bearerToken}` },
        };
      }
      const transport = new StreamableHTTPClientTransport(new URL(spec.url), opts);
      await client.connect(transport);
      return new McpSession(client, transport);
    }
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...process.env, ...(spec.env ?? {}) } as Record<string, string>,
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
