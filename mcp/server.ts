#!/usr/bin/env node
/**
 * MCP server exposing Now/Next/Later tasks to Claude Desktop.
 *
 * Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *
 *   "mcpServers": {
 *     "now-next-later": {
 *       "command": "npx",
 *       "args": ["tsx", "/absolute/path/to/now-next-later/mcp/server.ts"],
 *       "env": { "DATA_REPO_PATH": "/absolute/path/to/now-next-later" }
 *     }
 *   }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import {
  createTask,
  deleteTask,
  getAllTasks,
  reorderBucket,
  updateTask,
} from "../lib/storage";
import { ensurePulled } from "../lib/git-sync";
import type { Bucket } from "../lib/types";

const REPO_ROOT = process.env.DATA_REPO_PATH
  ? path.resolve(process.env.DATA_REPO_PATH)
  : process.cwd();

const server = new Server(
  { name: "now-next-later", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const BUCKET_VALUES = ["now", "next", "later"] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_tasks",
      description: "List tasks. Optionally filter by bucket and/or completion state.",
      inputSchema: {
        type: "object",
        properties: {
          bucket: { type: "string", enum: BUCKET_VALUES as unknown as string[] },
          includeCompleted: { type: "boolean", default: false },
        },
      },
    },
    {
      name: "add_task",
      description: "Create a new task in a bucket (defaults to 'now').",
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          bucket: { type: "string", enum: BUCKET_VALUES as unknown as string[] },
          notes: { type: "string" },
        },
      },
    },
    {
      name: "complete_task",
      description: "Mark a task complete (or pass completed=false to un-complete).",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          completed: { type: "boolean", default: true },
        },
      },
    },
    {
      name: "move_task",
      description: "Move a task to a different bucket.",
      inputSchema: {
        type: "object",
        required: ["id", "bucket"],
        properties: {
          id: { type: "string" },
          bucket: { type: "string", enum: BUCKET_VALUES as unknown as string[] },
        },
      },
    },
    {
      name: "update_task",
      description: "Update a task's title or notes.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    {
      name: "delete_task",
      description: "Delete a task permanently.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    {
      name: "reorder_bucket",
      description: "Replace the ordered list of task ids for a bucket.",
      inputSchema: {
        type: "object",
        required: ["bucket", "orderedIds"],
        properties: {
          bucket: { type: "string", enum: BUCKET_VALUES as unknown as string[] },
          orderedIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  ],
}));

function text(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  await ensurePulled(REPO_ROOT);
  const args = (req.params.arguments ?? {}) as Record<string, any>;

  switch (req.params.name) {
    case "list_tasks": {
      const all = await getAllTasks();
      const filtered = all.filter((t) => {
        if (args.bucket && t.bucket !== args.bucket) return false;
        if (!args.includeCompleted && t.completed) return false;
        return true;
      });
      filtered.sort((a, b) =>
        a.bucket === b.bucket ? a.position - b.position : a.bucket.localeCompare(b.bucket),
      );
      return text({ tasks: filtered });
    }
    case "add_task": {
      const task = await createTask({
        title: args.title,
        bucket: args.bucket as Bucket | undefined,
        notes: args.notes,
      });
      return text({ task });
    }
    case "complete_task": {
      const task = await updateTask(args.id, {
        completed: args.completed ?? true,
      });
      return text({ task });
    }
    case "move_task": {
      const task = await updateTask(args.id, { bucket: args.bucket as Bucket });
      return text({ task });
    }
    case "update_task": {
      const task = await updateTask(args.id, {
        title: args.title,
        notes: args.notes,
      });
      return text({ task });
    }
    case "delete_task": {
      const ok = await deleteTask(args.id);
      return text({ ok });
    }
    case "reorder_bucket": {
      const tasks = await reorderBucket(args.bucket as Bucket, args.orderedIds);
      return text({ tasks });
    }
    default:
      throw new Error(`Unknown tool: ${req.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("[now-next-later mcp] ready");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[now-next-later mcp] fatal", err);
  process.exit(1);
});
