import { randomUUID, createHash } from "node:crypto";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Store } from "./store.ts";
import { Tokens, assert, AppError } from "./security.ts";
import { normalizeUpload, renderMix } from "./audio.ts";
import { renderGuide, SONG_SECONDS } from "../shared/music.ts";
import {
  PEOPLE,
  type Actor,
  type State,
  type Song,
  type ToolResult,
  type Take,
  type Bootstrap,
  type SongView,
} from "../shared/types.ts";

const id = z.string().min(1).max(128);
const actor = z.enum(["alex", "ben", "mom"]);
export const schemas = {
  create_song: z
    .object({
      title: z.string().trim().min(1).max(80).default("A little closer"),
      idempotencyKey: id,
    })
    .strict(),
  get_song: z.object({ songId: id }).strict(),
  get_harmony_guide: z
    .object({ songId: id, part: z.enum(["lead", "harmony"]) })
    .strict(),
  start_recording_session: z
    .object({ songId: id, part: z.enum(["lead", "harmony"]) })
    .strict(),
  set_track_mix: z
    .object({
      songId: id,
      takeId: id,
      gain: z.number().min(0).max(1.5).optional(),
      offsetMs: z.number().min(-1500).max(1500).optional(),
      muted: z.boolean().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  create_mix: z.object({ songId: id }).strict(),
  get_mix_status: z.object({ jobId: id }).strict(),
  create_surprise: z
    .object({
      songId: id,
      mixId: id,
      recipient: actor.default("mom"),
      message: z
        .string()
        .trim()
        .max(240)
        .default("A little song, from us to you."),
      confirmationId: id.optional(),
    })
    .strict(),
  list_surprises: z.object({}).strict(),
  reveal_surprise: z.object({ surpriseId: id }).strict(),
} satisfies Record<string, z.ZodType>;
export type ToolName = keyof typeof schemas;
export const descriptions: Record<ToolName, string> = {
  create_song:
    "Create a project for the original A little closer exercise. Idempotent per user/key.",
  get_song:
    "Read an authorized song, independent takes, immutable mixes and playback links.",
  get_harmony_guide:
    "Get a curated instrumental lead or lower harmony guide. This is not generated from a recording.",
  start_recording_session:
    "Prepare a short-lived browser microphone recording card. Does not access Echo audio.",
  set_track_mix:
    "Adjust a take gain, mute, active status or signed offset. Positive offset delays the take.",
  create_mix:
    "Queue a real ffmpeg mix of active audible takes and immediately return a jobId.",
  get_mix_status:
    "Read mix job status and a short-lived playback URL when ready.",
  create_surprise:
    "Prepare a fixed-version private gift for confirmation. Commit requires a confirmation already accepted by the user UI. A model cannot accept it.",
  list_surprises:
    "List only the authenticated recipient’s musical gifts, without revealing audio.",
  reveal_surprise:
    "Open a gift as its recipient, after the recipient asks to listen. Does not mark playback complete.",
};
export const readOnlyTools = new Set<ToolName>([
  "get_song",
  "get_harmony_guide",
  "get_mix_status",
  "list_surprises",
]);
const iso = () => new Date().toISOString();

export class Harmony {
  private running = false;
  private stopped = false;
  readonly audioDir: string;
  constructor(
    readonly store: Store,
    readonly tokens: Tokens,
  ) {
    this.audioDir = path.join(store.directory, "audio");
    for (const part of ["lead", "harmony"] as const) {
      const file = path.join(this.audioDir, `guide-${part}.wav`);
      if (!existsSync(file))
        writeFileSync(file, renderGuide(part), { mode: 0o600 });
    }
    store.update((state) => {
      for (const mix of state.mixes)
        if (mix.status === "running") mix.status = "queued";
    });
    void this.runJobs();
  }
  member(state: State, actorId: Actor, songId: string): Song {
    const song = state.songs.find(
      (s) => s.id === songId && s.members.includes(actorId),
    );
    assert(song, "This song is not available to your account.", 403);
    return song;
  }
  assetUrl(file: string, actorId: Actor) {
    return `/api/audio/${encodeURIComponent(file)}?token=${this.tokens.sign({ purpose: "audio", file, actor: actorId }, 300)}`;
  }
  songView(state: State, song: Song, actorId: Actor): SongView {
    return {
      ...song,
      takes: state.takes
        .filter((t) => t.songId === song.id)
        .map((t) => ({ ...t, url: this.assetUrl(t.file, actorId) })),
      mixes: state.mixes
        .filter((m) => m.songId === song.id)
        .map((m) => ({
          ...m,
          ...(m.file ? { url: this.assetUrl(m.file, actorId) } : {}),
        })),
    };
  }
  bootstrap(actorId: Actor): Bootstrap {
    const state = this.store.read();
    return {
      actor: actorId,
      people: PEOPLE,
      songs: state.songs
        .filter((s) => s.members.includes(actorId))
        .map((s) => this.songView(state, s, actorId)),
      surprises: state.surprises
        .filter((s) => s.recipient === actorId)
        .map((s) => ({
          ...s,
          title:
            state.songs.find((song) => song.id === s.songId)?.title ??
            "A musical surprise",
          contributors: [
            ...new Set(
              state.mixes
                .find((m) => m.id === s.mixId)
                ?.tracks.map(
                  (t) => PEOPLE.find((p) => p.id === t.actor)!.name,
                ) ?? [],
            ),
          ],
          containsSamples:
            state.mixes
              .find((m) => m.id === s.mixId)
              ?.tracks.some((t) => t.source === "sample-tone") ?? false,
        })),
      traces: state.traces
        .filter((t) => t.actor === actorId)
        .slice(-40)
        .reverse(),
      agentMode: process.env.BEDROCK_MODEL_ID ? "bedrock" : "scripted",
      protocol: "2025-11-25",
      recordingSeconds: SONG_SECONDS,
    };
  }
  async call(
    actorId: Actor,
    name: ToolName,
    input: unknown,
  ): Promise<ToolResult> {
    const started = performance.now();
    try {
      // Parse again at the domain boundary: REST and MCP have identical constraints.
      const parsed = schemas[name].parse(input);
      const result = this.execute(
        actorId,
        name,
        parsed as Record<string, unknown>,
      );
      this.trace(
        actorId,
        name,
        started,
        true,
        name === "create_mix" ? "Mix job queued" : "Completed",
      );
      if (name === "create_mix") void this.runJobs();
      return result;
    } catch (error) {
      this.trace(
        actorId,
        name,
        started,
        false,
        error instanceof Error ? error.message.slice(0, 180) : "Tool failed",
      );
      throw error;
    }
  }
  private trace(
    actorId: Actor,
    name: string,
    start: number,
    ok: boolean,
    summary: string,
  ) {
    this.store.update((state) => {
      state.traces.push({
        id: randomUUID(),
        actor: actorId,
        name,
        at: iso(),
        durationMs: Math.round(performance.now() - start),
        ok,
        summary,
      });
      state.traces = state.traces.slice(-300);
    });
  }
  private execute(
    actorId: Actor,
    name: ToolName,
    a: Record<string, unknown>,
  ): ToolResult {
    return this.store.update((state) => {
      const songId = String(a.songId ?? "");
      if (name === "create_song") {
        const key = `${actorId}:${a.idempotencyKey}`;
        const payload = JSON.stringify({ title: a.title });
        const previous = state.idempotency[key];
        assert(
          !previous || previous.payload === payload,
          "This idempotency key was used with a different title.",
          409,
        );
        if (previous)
          return {
            song: this.songView(
              state,
              this.member(state, actorId, previous.id),
              actorId,
            ),
          };
        const song: Song = {
          id: randomUUID(),
          title: String(a.title),
          owner: actorId,
          members: actorId === "alex" ? ["alex", "ben"] : [actorId],
          createdAt: iso(),
        };
        state.songs.push(song);
        state.idempotency[key] = { payload, id: song.id };
        return { song: this.songView(state, song, actorId) };
      }
      if (name === "get_song")
        return {
          song: this.songView(
            state,
            this.member(state, actorId, songId),
            actorId,
          ),
        };
      if (name === "get_harmony_guide") {
        this.member(state, actorId, songId);
        return {
          part: a.part,
          url: this.assetUrl(`guide-${a.part}.wav`, actorId),
          source: "curated-guide-tone",
          title: "A little closer",
          bpm: 112,
          duration: SONG_SECONDS,
        };
      }
      if (name === "start_recording_session") {
        this.member(state, actorId, songId);
        assert(
          state.takes.filter((t) => t.songId === songId).length < 40,
          "This demo song has reached its take limit. Create another song.",
        );
        const session = {
          id: randomUUID(),
          actor: actorId,
          songId,
          part: a.part as "lead" | "harmony",
          expires: Date.now() + 10 * 60 * 1000,
        };
        state.recordings = state.recordings.filter(
          (r) => r.expires > Date.now(),
        );
        state.recordings.push(session);
        return {
          sessionId: session.id,
          part: session.part,
          expiresAt: new Date(session.expires).toISOString(),
          duration: SONG_SECONDS,
        };
      }
      if (name === "set_track_mix") {
        const song = this.member(state, actorId, songId);
        const take = state.takes.find(
          (t) => t.id === a.takeId && t.songId === songId,
        );
        assert(take, "Take not found.", 404);
        assert(
          actorId === song.owner || actorId === take.actor,
          "Only the singer or song owner can change this take.",
          403,
        );
        for (const key of ["gain", "offsetMs", "muted", "active"] as const)
          if (a[key] !== undefined) Object.assign(take, { [key]: a[key] });
        return { take: { ...take, url: this.assetUrl(take.file, actorId) } };
      }
      if (name === "create_mix") {
        this.member(state, actorId, songId);
        const tracks = state.takes.filter(
          (t) => t.songId === songId && t.active && !t.muted && t.gain > 0,
        );
        assert(
          tracks.length > 0 && tracks.length <= 8,
          "Record a take first; a mix supports up to eight audible takes.",
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(tracks.map((t) => [t.id, t.gain, t.offsetMs])))
          .digest("hex");
        const previous = state.mixes.find(
          (m) =>
            m.songId === songId &&
            m.fingerprint === fingerprint &&
            m.status !== "failed",
        );
        if (previous)
          return {
            jobId: previous.id,
            status: previous.status,
            ...(previous.file
              ? { url: this.assetUrl(previous.file, actorId) }
              : {}),
          };
        const mix = {
          id: randomUUID(),
          songId,
          actor: actorId,
          status: "queued" as const,
          tracks: structuredClone(tracks),
          createdAt: iso(),
          fingerprint,
        };
        state.mixes.push(mix);
        return { jobId: mix.id, status: mix.status };
      }
      if (name === "get_mix_status") {
        const mix = state.mixes.find((m) => m.id === a.jobId);
        assert(mix, "Mix not found.", 404);
        this.member(state, actorId, mix.songId);
        return {
          jobId: mix.id,
          status: mix.status,
          error: mix.error,
          ...(mix.file ? { url: this.assetUrl(mix.file, actorId) } : {}),
        };
      }
      if (name === "create_surprise") {
        const song = this.member(state, actorId, songId);
        assert(
          song.owner === actorId,
          "Only the song owner can share a musical gift.",
          403,
        );
        const mix = state.mixes.find(
          (m) =>
            m.id === a.mixId && m.songId === songId && m.status === "ready",
        );
        assert(mix, "Choose a finished mix before preparing a gift.");
        assert(
          a.recipient !== actorId,
          "Choose someone else to receive the gift.",
        );
        if (!a.confirmationId) {
          const confirmation = {
            id: randomUUID(),
            actor: actorId,
            songId,
            mixId: mix.id,
            recipient: a.recipient as Actor,
            message: String(a.message),
            expires: Date.now() + 5 * 60 * 1000,
          };
          state.confirmations = state.confirmations.filter(
            (c) => c.expires > Date.now(),
          );
          state.confirmations.push(confirmation);
          return {
            requiresConfirmation: true,
            confirmationId: confirmation.id,
            recipient: confirmation.recipient,
            mixId: mix.id,
            message: confirmation.message,
          };
        }
        const c = state.confirmations.find(
          (c) => c.id === a.confirmationId && c.actor === actorId,
        );
        assert(
          c && c.expires > Date.now() && c.acceptedAt,
          "Please confirm this gift in the sharing card first.",
          403,
        );
        assert(
          c.songId === songId &&
            c.mixId === a.mixId &&
            c.recipient === a.recipient &&
            c.message === a.message,
          "The gift changed. Please review a new confirmation.",
          409,
        );
        if (c.surpriseId)
          return {
            surprise: state.surprises.find((s) => s.id === c.surpriseId),
          };
        const surprise = {
          id: randomUUID(),
          songId,
          mixId: mix.id,
          sender: actorId,
          recipient: c.recipient,
          message: c.message,
          createdAt: iso(),
        };
        state.surprises.push(surprise);
        c.surpriseId = surprise.id;
        return { surprise };
      }
      if (name === "list_surprises")
        return {
          surprises: state.surprises.filter((s) => s.recipient === actorId),
        };
      if (name === "reveal_surprise") {
        const surprise = state.surprises.find(
          (s) => s.id === a.surpriseId && s.recipient === actorId,
        );
        assert(surprise, "This gift is not available to your account.", 403);
        const mix = state.mixes.find(
          (m) => m.id === surprise.mixId && m.status === "ready",
        );
        assert(mix?.file, "The gift audio is not ready.", 409);
        surprise.openedAt ??= iso();
        return {
          surprise,
          url: this.assetUrl(mix.file, actorId),
          source: mix.tracks.some((t) => t.source === "sample-tone")
            ? "Contains sample guide tones"
            : "Human recordings",
        };
      }
      throw new AppError("Unknown tool.", 404);
    });
  }
  acceptConfirmation(actorId: Actor, confirmationId: string) {
    return this.store.update((state) => {
      const confirmation = state.confirmations.find(
        (c) =>
          c.id === confirmationId &&
          c.actor === actorId &&
          c.expires > Date.now(),
      );
      assert(
        confirmation,
        "This confirmation expired. Prepare the gift again.",
        404,
      );
      confirmation.acceptedAt ??= iso();
      return structuredClone(confirmation);
    });
  }
  async upload(
    actorId: Actor,
    sessionId: string,
    bytes: Buffer,
    metadata: { offsetMs?: number; capture?: Take["capture"] } = {},
    sample = false,
  ) {
    const session = this.store
      .read()
      .recordings.find(
        (r) =>
          r.id === sessionId && r.actor === actorId && r.expires > Date.now(),
      );
    assert(session, "Recording session expired. Start another take.", 403);
    if (session.takeId) return { takeId: session.takeId };
    const captureShift = metadata.capture
      ? ((metadata.capture.firstFrame - metadata.capture.scheduledFrame) /
          metadata.capture.sampleRate) *
        1000
      : 0;
    const offsetMs = (metadata.offsetMs ?? 0) + captureShift;
    assert(
      Number.isFinite(offsetMs) && Math.abs(offsetMs) <= 1500,
      "Audio capture started too late. Please try a new take.",
    );
    const audio = await normalizeUpload(bytes, this.audioDir);
    try {
      return this.store.update((state) => {
        const current = state.recordings.find(
          (r) =>
            r.id === sessionId && r.actor === actorId && r.expires > Date.now(),
        );
        assert(current, "Recording session expired.", 403);
        this.member(state, actorId, current.songId);
        if (current.takeId) {
          unlinkSync(path.join(this.audioDir, audio.file));
          return { takeId: current.takeId };
        }
        // A retake preserves the file and metadata; only the previous take selection changes.
        for (const take of state.takes)
          if (
            take.songId === current.songId &&
            take.actor === actorId &&
            take.part === current.part
          )
            take.active = false;
        const take: Take = {
          id: randomUUID(),
          songId: current.songId,
          actor: actorId,
          part: current.part,
          ...audio,
          gain: 0.8,
          offsetMs: Math.round(offsetMs),
          muted: false,
          active: true,
          createdAt: iso(),
          source: sample ? "sample-tone" : "microphone",
          capture: metadata.capture,
        };
        state.takes.push(take);
        current.takeId = take.id;
        return { takeId: take.id };
      });
    } catch (error) {
      if (existsSync(path.join(this.audioDir, audio.file)))
        unlinkSync(path.join(this.audioDir, audio.file));
      throw error;
    }
  }
  markPlayed(actorId: Actor, surpriseId: string) {
    this.store.update((state) => {
      const surprise = state.surprises.find(
        (s) => s.id === surpriseId && s.recipient === actorId && s.openedAt,
      );
      assert(surprise, "Open this gift before recording playback.", 403);
      surprise.playedAt ??= iso();
    });
  }
  authorizeAudio(actorId: Actor, file: string) {
    const state = this.store.read();
    if (file === "guide-lead.wav" || file === "guide-harmony.wav") return;
    const take = state.takes.find((t) => t.file === file);
    if (take) {
      this.member(state, actorId, take.songId);
      return;
    }
    const mix = state.mixes.find(
      (m) => m.file === file && m.status === "ready",
    );
    assert(mix, "Audio not found.", 404);
    if (
      state.songs.some(
        (s) => s.id === mix.songId && s.members.includes(actorId),
      )
    )
      return;
    assert(
      state.surprises.some(
        (s) => s.mixId === mix.id && s.recipient === actorId && s.openedAt,
      ),
      "You cannot access this recording.",
      403,
    );
  }
  async runJobs() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const mix = this.store.update((state) => {
          const next = state.mixes.find((m) => m.status === "queued");
          if (next) next.status = "running";
          return next ? structuredClone(next) : undefined;
        });
        if (!mix) break;
        try {
          const file = await renderMix(mix.tracks, this.audioDir, mix.id);
          this.store.update((state) => {
            Object.assign(
              state.mixes.find((m) => m.id === mix.id)!,
              { file, status: "ready" },
            );
          });
        } catch {
          this.store.update((state) => {
            Object.assign(
              state.mixes.find((m) => m.id === mix.id)!,
              {
                status: "failed",
                error:
                  "Audio rendering failed. Check ffmpeg and try a new mix.",
              },
            );
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
  stop() {
    this.stopped = true;
  }
}
