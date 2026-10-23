// Read-only transport smoke test against an already running local app.
// Signs a local MCP token; does not create recordings or gifts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import { Tokens } from "../server/security.ts";

const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
const health = await fetch(`${base}/api/health`);
if (!health.ok) throw new Error("App is not healthy");
const unauth = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
if (unauth.status !== 401 || unauth.headers.has("www-authenticate"))
  throw new Error("Unexpected unauthenticated MCP response");
const secret =
  process.env.SESSION_SECRET ||
  readFileSync(
    path.resolve(process.env.DATA_DIR || ".data", "session-secret"),
    "utf8",
  ).trim();
const token = new Tokens(secret).sign({ purpose: "mcp", actor: "alex" }, 30);
const initialized = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1" },
    },
  }),
});
const protocol = (await initialized.json()).result?.protocolVersion;
if (protocol !== "2025-11-25")
  throw new Error(`Unexpected protocol ${protocol}`);
const client = new Client({ name: "harmonymate-smoke", version: "0.1.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  const song = await client.callTool({
    name: "get_song",
    arguments: { songId: "a-little-closer" },
  });
  if (song.isError) throw new Error("get_song failed");
  console.log(
    JSON.stringify(
      {
        health: "ok",
        protocol,
        transport: "Streamable HTTP",
        tools: tools.tools.map((t) => t.name),
        get_song: "ok",
        unauthorized: 401,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
