import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.ts";

test("a fresh visitor enters the demo and switches singer without logging in", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-entry-"));
  let base = "";
  const runtime = createApp({
    directory,
    secret: "entry-test-only",
    mcpUrl: () => `${base}/mcp`,
  });
  runtime.app.use(runtime.errors);
  const server = createServer(runtime.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const fresh = await fetch(`${base}/api/bootstrap`);
    assert.equal(fresh.status, 200, "The app must open without credentials");
    assert.equal((await fresh.json()).actor, "alex");
    assert.ok(fresh.headers.get("set-cookie")?.includes("HttpOnly"));
    const changed = await fetch(`${base}/api/demo/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "mom" }),
    });
    assert.equal(
      changed.status,
      200,
      "Switching demo roles must not require a password",
    );
    const cookie = changed.headers.get("set-cookie")!.split(";")[0];
    const mom = await fetch(`${base}/api/bootstrap`, {
      headers: { Cookie: cookie },
    });
    const data = await mom.json();
    assert.equal(data.actor, "mom");
    assert.equal(
      data.songs.length,
      0,
      "Role-specific access must still be enforced",
    );
    const mcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(
      mcp.status,
      401,
      "Removing the login screen must not expose MCP credentials",
    );
  } finally {
    runtime.harmony.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
