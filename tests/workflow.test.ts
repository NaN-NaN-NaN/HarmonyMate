import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.ts";
import type { Bootstrap, ToolResult } from "../shared/types.ts";
import { renderGuide } from "../shared/music.ts";

test("real HTTP MCP → independent takes → ffmpeg → confirmed private gift, with authorization and replay protection", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harmonymate-test-"));
  const directory = path.join(root, ".data");
  let url = "";
  const runtime = createApp({
    directory,
    secret: "integration-test-secret",
    mcpUrl: () => `${url}/mcp`,
  });
  runtime.app.use(runtime.errors);
  const server = createServer(runtime.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (route: string, options?: RequestInit) =>
    fetch(`${url}${route}`, options);
  const cookies: Record<string, string> = {};
  async function selectProfile(actor: string) {
    const response = await request("/api/demo/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });
    assert.equal(response.status, 200);
    cookies[actor] = response.headers.get("set-cookie")!.split(";")[0];
  }
  async function api(
    actor: string,
    route: string,
    body?: Record<string, unknown>,
  ) {
    return request(route, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookies[actor], "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function call(
    actor: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const response = await api(actor, `/api/tools/${name}`, args);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    const unauth = await request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.headers.has("www-authenticate"), false);
    assert.equal((await request("/api/bootstrap")).status, 200);
    for (const actor of ["alex", "ben", "mom"]) await selectProfile(actor);
    const invalidOrigin = await request("/api/tools/create_song", {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        Cookie: cookies.alex,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(invalidOrigin.status, 403);

    const token = runtime.harmony.tokens.sign(
      { purpose: "mcp", actor: "alex" },
      60,
    );
    const initialized = await request("/mcp", {
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
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    assert.equal(initialized.status, 200);
    assert.equal(
      (await initialized.json()).result.protocolVersion,
      "2025-11-25",
    );
    const client = await runtime.tools.connect("alex");
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 10);
      assert.ok(listed.tools.some((t) => t.name === "create_mix"));
    } finally {
      await client.close();
    }

    const created = await call("alex", "create_song", {
      title: "Test duet",
      idempotencyKey: "one",
    });
    const songId = (created.song as { id: string }).id;
    const guideResponse = await api("alex", "/api/agent", {
      text: "Teach me the lower harmony",
      songId,
    });
    assert.equal(guideResponse.status, 200);
    const guidance = await guideResponse.json();
    assert.equal(guidance.mode, "scripted");
    assert.equal(guidance.action.type, "guide");
    assert.equal(guidance.action.part, "harmony");
    assert.equal((await request(guidance.action.url)).status, 200);
    const same = await call("alex", "create_song", {
      title: "Test duet",
      idempotencyKey: "one",
    });
    assert.equal((same.song as { id: string }).id, songId);
    assert.notEqual(
      (
        await api("alex", "/api/tools/create_song", {
          title: "Changed",
          idempotencyKey: "one",
        })
      ).status,
      200,
    );
    assert.notEqual(
      (await api("mom", "/api/tools/get_song", { songId })).status,
      200,
    );
    await call("ben", "get_song", { songId });

    const leadSession = await call("alex", "start_recording_session", {
      songId,
      part: "lead",
    });
    assert.equal(
      (await api("ben", `/api/recordings/${leadSession.sessionId}/sample`, {}))
        .status,
      404,
    );
    const first = await api(
      "alex",
      `/api/recordings/${leadSession.sessionId}/sample`,
      {},
    );
    assert.equal(first.status, 200);
    const firstId = (await first.json()).takeId;
    const replay = await api(
      "alex",
      `/api/recordings/${leadSession.sessionId}/sample`,
      {},
    );
    assert.equal((await replay.json()).takeId, firstId);
    const original = runtime.store.read().takes.find((t) => t.id === firstId)!;
    const originalBytes = readFileSync(
      path.join(runtime.harmony.audioDir, original.file),
    );
    const harmonySession = await call("ben", "start_recording_session", {
      songId,
      part: "harmony",
    });
    const second = await api(
      "ben",
      `/api/recordings/${harmonySession.sessionId}/sample`,
      {},
    );
    assert.equal(second.status, 200);
    const secondId = (await second.json()).takeId;
    assert.notEqual(
      (
        await api("ben", "/api/tools/set_track_mix", {
          songId,
          takeId: firstId,
          gain: 0,
        })
      ).status,
      200,
    );
    await call("ben", "set_track_mix", {
      songId,
      takeId: secondId,
      offsetMs: -40,
      gain: 0.6,
    });
    const job = await call("alex", "create_mix", { songId });
    assert.ok(["queued", "running"].includes(String(job.status)));
    let status: ToolResult = {};
    for (let i = 0; i < 100; i++) {
      status = await call("alex", "get_mix_status", { jobId: job.jobId });
      if (status.status === "ready" || status.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(status.status, "ready");
    const mixAudio = await request(String(status.url));
    assert.equal(mixAudio.status, 200);
    assert.ok((await mixAudio.arrayBuffer()).byteLength > 100000);
    const sameJob = await call("alex", "create_mix", { songId });
    assert.equal(sameJob.jobId, job.jobId);
    const readyMix = runtime.store
      .read()
      .mixes.find((m) => m.id === job.jobId)!;
    assert.equal(readyMix.tracks.length, 2);

    const giftInput = {
      songId,
      mixId: job.jobId,
      recipient: "mom",
      message: "An original test song.",
    };
    assert.notEqual(
      (
        await api("alex", "/api/tools/create_surprise", {
          ...giftInput,
          confirmed: true,
        })
      ).status,
      200,
    );
    const prepared = await call("alex", "create_surprise", giftInput);
    assert.notEqual(
      (
        await api("alex", "/api/tools/create_surprise", {
          ...giftInput,
          confirmationId: prepared.confirmationId,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api(
          "ben",
          `/api/confirmations/${prepared.confirmationId}/accept`,
          {},
        )
      ).status,
      404,
    );
    const sent = await api(
      "alex",
      `/api/confirmations/${prepared.confirmationId}/accept`,
      {},
    );
    assert.equal(sent.status, 200);
    const gift = (await sent.json()).surprise;
    const sentAgain = await api(
      "alex",
      `/api/confirmations/${prepared.confirmationId}/accept`,
      {},
    );
    assert.equal((await sentAgain.json()).surprise.id, gift.id);
    assert.notEqual(
      (await api("ben", "/api/tools/reveal_surprise", { surpriseId: gift.id }))
        .status,
      200,
    );
    const inbox = await call("mom", "list_surprises");
    assert.equal((inbox.surprises as unknown[]).length, 1);
    const premature = runtime.harmony.assetUrl(readyMix.file!, "mom");
    assert.equal((await request(premature)).status, 403);
    const revealed = await call("mom", "reveal_surprise", {
      surpriseId: gift.id,
    });
    assert.equal((await request(String(revealed.url))).status, 200);
    assert.equal(
      runtime.store.read().surprises.find((s) => s.id === gift.id)?.playedAt,
      undefined,
    );
    assert.equal(
      (await api("mom", `/api/surprises/${gift.id}/played`, {})).status,
      200,
    );
    assert.ok(
      runtime.store.read().surprises.find((s) => s.id === gift.id)?.playedAt,
    );
    const expired = runtime.harmony.tokens.sign(
      { purpose: "audio", actor: "mom", file: readyMix.file },
      -1,
    );
    assert.equal(
      (await request(`/api/audio/${readyMix.file}?token=${expired}`)).status,
      401,
    );

    // Retake creates a third independent file; shared mix still points at the original two.
    const retakeSession = await call("alex", "start_recording_session", {
      songId,
      part: "lead",
    });
    const retake = await request(
      `/api/recordings/${retakeSession.sessionId}/audio`,
      {
        method: "POST",
        headers: { Cookie: cookies.alex, "Content-Type": "audio/wav" },
        body: new Uint8Array(renderGuide("lead")),
      },
    );
    assert.equal(retake.status, 200);
    assert.deepEqual(
      readFileSync(path.join(runtime.harmony.audioDir, original.file)),
      originalBytes,
    );
    assert.equal(
      runtime.store.read().takes.find((t) => t.id === firstId)?.active,
      false,
    );
    assert.equal(
      runtime.store.read().mixes.find((m) => m.id === job.jobId)?.tracks[0].id,
      firstId,
    );
    const momData = (await (
      await api("mom", "/api/bootstrap")
    ).json()) as Bootstrap;
    assert.equal(momData.songs.length, 0);
    assert.equal(momData.surprises.length, 1);
    assert.ok(momData.traces.every((t) => t.actor === "mom"));
  } finally {
    runtime.harmony.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
