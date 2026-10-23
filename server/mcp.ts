import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  descriptions,
  readOnlyTools,
  schemas,
  type Harmony,
  type ToolName,
} from "./domain.ts";
import type { Actor, ToolResult } from "../shared/types.ts";
import { AppError } from "./security.ts";

export function mountMcp(app: Express, harmony: Harmony) {
  app.post("/mcp", async (req: Request, res: Response) => {
    const actor = harmony.tokens.actor(
      (req.headers.authorization ?? "").replace(/^Bearer /, ""),
      "mcp",
    );
    const server = new McpServer({ name: "harmonymate", version: "0.1.0" });
    for (const name of Object.keys(schemas) as ToolName[]) {
      server.registerTool(
        name,
        {
          description: descriptions[name],
          inputSchema: schemas[name],
          annotations: {
            readOnlyHint: readOnlyTools.has(name),
            destructiveHint: false,
            idempotentHint: [
              "get_song",
              "get_harmony_guide",
              "get_mix_status",
              "list_surprises",
              "create_song",
              "create_mix",
              "set_track_mix",
            ].includes(name),
            openWorldHint: false,
          },
        },
        async (args: Record<string, unknown>): Promise<CallToolResult> => {
          try {
            const result = await harmony.call(actor, name, args);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : "Tool failed.",
                },
              ],
            };
          }
        },
      );
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (req, res) => {
    harmony.tokens.actor(
      (req.headers.authorization ?? "").replace(/^Bearer /, ""),
      "mcp",
    );
    res.status(405).json({
      error: "Use POST with Streamable HTTP. This server is stateless.",
    });
  });
}

// Even scripted UI commands cross a real HTTP MCP client/server boundary.
export class ToolClient {
  constructor(
    readonly harmony: Harmony,
    readonly url: () => string,
  ) {}
  async connect(actor: Actor) {
    const client = new Client({
      name: "harmonymate-simulator",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(this.url()), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.harmony.tokens.sign({ purpose: "mcp", actor }, 120)}`,
        },
      },
    });
    await client.connect(transport);
    return client;
  }
  async call(
    actor: Actor,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const client = await this.connect(actor);
    try {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const first = Array.isArray(result.content)
          ? result.content[0]
          : undefined;
        throw new AppError(
          first?.type === "text" ? String(first.text) : "Tool failed.",
          400,
        );
      }
      return result.structuredContent as ToolResult;
    } finally {
      await client.close();
    }
  }
}
