import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z, ZodError } from "zod";
import { Store } from "./store.ts";
import { Tokens, AppError, assert, isActor } from "./security.ts";
import { Harmony, schemas, type ToolName } from "./domain.ts";
import { mountMcp, ToolClient } from "./mcp.ts";
import { Agent } from "./agent.ts";
import { renderGuide } from "../shared/music.ts";
import type { Actor } from "../shared/types.ts";

export function createApp(options: {
  directory: string;
  secret?: string;
  mcpUrl: () => string;
}) {
  const store = new Store(options.directory);
  const secretFile = path.join(options.directory, "session-secret");
  let secret = options.secret;
  if (!secret) {
    if (!existsSync(secretFile))
      writeFileSync(secretFile, randomBytes(32).toString("hex"), {
        mode: 0o600,
      });
    secret = readFileSync(secretFile, "utf8").trim();
  }
  const harmony = new Harmony(store, new Tokens(secret));
  const tools = new ToolClient(harmony, options.mcpUrl);
  const agent = new Agent(harmony, tools);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
    if (req.path.startsWith("/api") || req.path === "/mcp")
      res.setHeader("Cache-Control", "no-store");
    // Protect cookie-authenticated mutations and MCP against cross-site browser calls.
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    if (
      origin &&
      origin !== expected &&
      origin !== `https://${req.headers.host}`
    )
      return next(new AppError("This origin is not allowed.", 403));
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  const selectProfile = (res: Response, actor: Actor) => {
    res.cookie(
      "harmony_session",
      harmony.tokens.sign({ purpose: "session", actor }, 12 * 60 * 60),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.PUBLIC_ORIGIN?.startsWith("https://") ?? false,
        maxAge: 12 * 60 * 60 * 1000,
      },
    );
  };
  const identity = (req: Request, res: Response): Actor => {
    const cookie = (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("harmony_session="))
      ?.slice("harmony_session=".length);
    if (cookie) {
      try {
        return harmony.tokens.actor(cookie, "session");
      } catch (error) {
        if (!(error instanceof AppError && error.status === 401)) throw error;
      }
    }
    // This is a freely switchable demo role, not a production login.
    selectProfile(res, "alex");
    return "alex";
  };
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      storage: "sqlite-private-files",
      mcp: "Streamable HTTP",
      agentMode: process.env.BEDROCK_MODEL_ID ? "bedrock" : "scripted",
    }),
  );
  app.post("/api/demo/profile", (req, res) => {
    const { actor } = z
      .object({ actor: z.enum(["alex", "ben", "mom"]) })
      .strict()
      .parse(req.body);
    selectProfile(res, actor);
    res.json({ actor });
  });
  app.get("/api/bootstrap", (req, res) =>
    res.json(harmony.bootstrap(identity(req, res))),
  );
  app.post("/api/tools/:name", async (req, res) => {
    const actor = identity(req, res);
    assert(Object.hasOwn(schemas, req.params.name), "Tool not found.", 404);
    res.json(await tools.call(actor, req.params.name as ToolName, req.body));
  });
  app.post("/api/agent", async (req, res) => {
    const actor = identity(req, res);
    const input = z
      .object({
        text: z.string().trim().min(1).max(1000),
        songId: z.string().max(128).optional(),
        selectedTakeIds: z.array(z.string().min(1).max(128)).max(8).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await agent.respond(
        actor,
        input.text,
        input.songId,
        input.selectedTakeIds,
      ),
    );
  });
  const captureSchema = z
    .object({
      firstFrame: z.number().int().nonnegative(),
      scheduledFrame: z.number().int().nonnegative(),
      sampleRate: z.number().int().min(8000).max(192000),
      baseLatency: z.number().nonnegative().max(10),
      outputLatency: z.number().nonnegative().max(10),
      echoCancellation: z.boolean().optional(),
      noiseSuppression: z.boolean().optional(),
      autoGainControl: z.boolean().optional(),
    })
    .strict();
  app.post(
    "/api/recordings/:id/audio",
    express.raw({ type: "audio/wav", limit: "8mb" }),
    async (req, res) => {
      const actor = identity(req, res);
      assert(Buffer.isBuffer(req.body), "Expected audio/wav.");
      const offsetMs = z.coerce
        .number()
        .min(-1500)
        .max(1500)
        .parse(req.headers["x-offset-ms"] || 0);
      const capture = req.headers["x-capture"]
        ? captureSchema.parse(JSON.parse(String(req.headers["x-capture"])))
        : undefined;
      res.json(
        await harmony.upload(actor, String(req.params.id), req.body, {
          offsetMs,
          capture,
        }),
      );
    },
  );
  app.post("/api/recordings/:id/sample", async (req, res) => {
    const actor = identity(req, res);
    const session = store
      .read()
      .recordings.find((r) => r.id === req.params.id && r.actor === actor);
    assert(session, "Recording session not found.", 404);
    res.json(
      await harmony.upload(
        actor,
        session.id,
        Buffer.from(renderGuide(session.part)),
        {},
        true,
      ),
    );
  });
  app.post("/api/confirmations/:id/accept", async (req, res) => {
    const actor = identity(req, res);
    const c = harmony.acceptConfirmation(actor, String(req.params.id));
    res.json(
      await tools.call(actor, "create_surprise", {
        songId: c.songId,
        mixId: c.mixId,
        recipient: c.recipient,
        message: c.message,
        confirmationId: c.id,
      }),
    );
  });
  app.get("/api/confirmations/:id", (req, res) => {
    const actor = identity(req, res);
    const c = store
      .read()
      .confirmations.find(
        (c) =>
          c.id === req.params.id && c.actor === actor && c.expires > Date.now(),
      );
    assert(c, "This confirmation expired. Prepare the gift again.", 404);
    res.json(c);
  });
  app.post("/api/surprises/:id/played", (req, res) => {
    harmony.markPlayed(identity(req, res), String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/audio/:file", (req, res) => {
    const file = String(req.params.file);
    assert(/^[a-zA-Z0-9-]+\.wav$/.test(file), "Invalid audio path.", 404);
    const data = harmony.tokens.verify(String(req.query.token || ""), "audio");
    assert(
      data.file === file && isActor(data.actor),
      "This audio link is invalid.",
      403,
    );
    harmony.authorizeAudio(data.actor, file);
    res.setHeader("Content-Type", "audio/wav");
    // The authenticated private directory is intentionally named .data. Express
    // otherwise rejects any dot-directory in an absolute sendFile path.
    res.sendFile(path.resolve(harmony.audioDir, file), { dotfiles: "allow" });
  });
  mountMcp(app, harmony);
  const errors = (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    if (res.headersSent) return;
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : (error as { status?: number })?.status === 413
            ? 413
            : 500;
    if (status === 500) console.error(error);
    res.status(status).json({
      error:
        error instanceof ZodError
          ? error.issues
              .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
              .join("; ")
          : status === 500
            ? "Something went wrong. Please try again."
            : error instanceof Error
              ? error.message
              : "Request failed.",
    });
  };
  return { app, harmony, store, tools, errors };
}
