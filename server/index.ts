import "dotenv/config";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createApp } from "./app.ts";
import express from "express";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const runtime = createApp({
  directory: path.resolve(process.env.DATA_DIR || ".data"),
  secret: process.env.SESSION_SECRET || undefined,
  mcpUrl: () => `http://127.0.0.1:${port}/mcp`,
});
if (process.env.NODE_ENV === "production") {
  if (!existsSync("dist/index.html"))
    throw new Error("Run npm run build before starting in production.");
  runtime.app.use(express.static(path.resolve("dist")));
  runtime.app.get("/{*path}", (req, res, next) =>
    req.path.startsWith("/api/")
      ? next()
      : res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  runtime.app.use(vite.middlewares);
}
runtime.app.use(runtime.errors);
const server = createServer(runtime.app);
server.listen(port, host, () => {
  console.log(`HarmonyMate → http://${host}:${port}`);
  console.log(
    `MCP → http://${host}:${port}/mcp (authenticated Streamable HTTP)`,
  );
  console.log(
    `Agent → ${process.env.BEDROCK_MODEL_ID ? "Bedrock (unverified until first successful call)" : "Scripted simulator; set BEDROCK_MODEL_ID to enable AI"}`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    runtime.harmony.stop();
    server.close(() => process.exit(0));
  });
