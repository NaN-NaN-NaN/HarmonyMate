import { randomUUID, createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Store } from "./store.ts";
import { Tokens, assert, AppError } from "./security.ts";
import { normalizeUpload, renderMix } from "./audio.ts";
import { RECORDING_SECONDS } from "../shared/music.ts";
import { renderHarmony } from "./harmonize.ts";
import {
  PEOPLE,
  DEFAULT_HARMONY,
  harmonyLabel,
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
const trackIds = z
  .array(id)
  .min(1)
  .max(8)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Select each track only once.",
  );
const harmonyOptions = {
  direction: z.enum(["higher", "lower"]).default("lower"),
  interval: z.union([z.literal(3), z.literal(5), z.literal(6)]).default(3),
};
export const schemas = {
  create_song: z
    .object({
      title: z.string().trim().min(1).max(80).default("Untitled song"),
      idempotencyKey: id,
    })
    .strict(),
  get_song: z.object({ songId: id }).strict(),
  list_tracks: z.object({ songId: id }).strict(),
  play_tracks: z.object({ songId: id, takeIds: trackIds }).strict(),
  review_take: z
    .object({
      songId: id,
      takeId: id,
      decision: z.enum(["keep", "discard", "restore"]),
    })
    .strict(),
  generate_harmony: z
    .object({ songId: id, takeId: id, ...harmonyOptions })
    .strict(),
  start_recording_session: z
    .object({
      songId: id,
      part: z.enum(["lead", "harmony"]),
      referenceTakeIds: trackIds.optional(),
      addTrack: z.boolean().default(false),
      replacesTakeId: id.optional(),
    })
    .strict(),
  set_track_mix: z
    .object({
      songId: id,
      takeId: id,
      name: z.string().trim().min(1).max(80).optional(),
      gain: z.number().min(0).max(1.5).optional(),
      offsetMs: z.number().min(-1500).max(1500).optional(),
      muted: z.boolean().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  create_mix: z.object({ songId: id, takeIds: trackIds.optional() }).strict(),
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
    "Create a project for a short song the user chooses to sing. Idempotent per user/key.",
  get_song:
    "Read an authorized song, independent takes, immutable mixes and playback links.",
  list_tracks:
    "List all kept tracks with stable track numbers, names, origin, playback URLs and mix settings. Drafts are excluded.",
  play_tracks:
    "Return authorized independent tracks to play together using exactly the selected takeIds (one to eight). This does not record or alter the song.",
  review_take:
    "Keep, discard or restore the singer’s own recorded draft only when they explicitly ask. A draft never replaces a kept take before confirmation. Discard is reversible.",
  generate_harmony:
    "Queue a generated high or low 3rd, perfect 5th, or diatonic 6th from a kept source recording. Each variant becomes an independent track. Uses DSP, not a generative AI voice model. Returns a jobId immediately; source audio remains unchanged.",
  start_recording_session:
    "Prepare a browser microphone card for up to 30 seconds. For overdubbing set referenceTakeIds, part=harmony, addTrack=true; the client plays these exact tracks in headphones while capturing a separate microphone track. For a retake set replacesTakeId. Recording requires a user click; the result is a draft for review. Does not access Echo audio.",
  set_track_mix:
    "Adjust a take gain, mute, active status or signed offset. Positive offset delays the take.",
  create_mix:
    "Queue a real ffmpeg mix from explicit takeIds, or all active audible kept tracks when omitted. Returns a jobId immediately.",
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
  "list_tracks",
  "play_tracks",
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
    store.update((state) => {
      // Lift earlier generated stems out of mix snapshots without changing files/gifts.
      for (const mix of state.mixes) {
        if (mix.status === "running") mix.status = "queued";
        for (const take of mix.tracks) {
          if (
            mix.status === "ready" &&
            take.source === "generated-harmony" &&
            !state.takes.some((t) => t.id === take.id)
          )
            state.takes.push({
              ...take,
              name: harmonyLabel(mix.harmonyOptions),
              harmonyOptions: mix.harmonyOptions ?? DEFAULT_HARMONY,
              reviewStatus: "kept",
              active: true,
            });
        }
      }
      for (const take of state.takes) {
        take.trackNumber ??= this.nextTrackNumber(state, take.songId);
        take.name ??=
          take.source === "generated-harmony"
            ? harmonyLabel(take.harmonyOptions)
            : `${PEOPLE.find((p) => p.id === take.actor)!.name} · ${take.part === "lead" ? "Voice" : "Sung harmony"}`;
      }
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
  private nextTrackNumber(state: State, songId: string) {
    return (
      Math.max(
        0,
        ...state.takes
          .filter((t) => t.songId === songId)
          .map((t) => t.trackNumber ?? 0),
      ) + 1
    );
  }
  private selectedTracks(
    state: State,
    actorId: Actor,
    songId: string,
    ids: string[],
  ) {
    this.member(state, actorId, songId);
    return ids.map((id) => {
      const take = state.takes.find(
        (t) =>
          t.id === id &&
          t.songId === songId &&
          (t.reviewStatus ?? "kept") === "kept",
      );
      assert(
        take,
        "A selected track is unavailable or has not been kept.",
        403,
      );
      return take;
    });
  }
  assetUrl(file: string, actorId: Actor) {
    return `/api/audio/${encodeURIComponent(file)}?token=${this.tokens.sign({ purpose: "audio", file, actor: actorId }, 300)}`;
  }
  songView(state: State, song: Song, actorId: Actor): SongView {
    return {
      ...song,
      takes: state.takes
        .filter(
          (t) =>
            t.songId === song.id &&
            ((t.reviewStatus ?? "kept") === "kept" || t.actor === actorId),
        )
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
          containsGeneratedHarmony:
            state.mixes
              .find((m) => m.id === s.mixId)
              ?.tracks.some((t) => t.source === "generated-harmony") ?? false,
        })),
      traces: state.traces
        .filter((t) => t.actor === actorId)
        .slice(-40)
        .reverse(),
      agentMode: process.env.BEDROCK_MODEL_ID ? "bedrock" : "scripted",
      protocol: "2025-11-25",
      recordingSeconds: 30,
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
        name === "create_mix" || name === "generate_harmony"
          ? "Audio job queued"
          : "Completed",
      );
      if (name === "create_mix" || name === "generate_harmony")
        void this.runJobs();
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
      if (name === "list_tracks") {
        const view = this.songView(
          state,
          this.member(state, actorId, songId),
          actorId,
        );
        return {
          tracks: view.takes.filter(
            (t) => (t.reviewStatus ?? "kept") === "kept",
          ),
        };
      }
      if (name === "play_tracks") {
        const tracks = this.selectedTracks(
          state,
          actorId,
          songId,
          a.takeIds as string[],
        );
        return {
          tracks: tracks.map((t) => ({
            ...t,
            url: this.assetUrl(t.file, actorId),
          })),
          takeIds: tracks.map((t) => t.id),
        };
      }
      if (name === "review_take") {
        this.member(state, actorId, songId);
        const take = state.takes.find(
          (t) =>
            t.id === a.takeId && t.songId === songId && t.actor === actorId,
        );
        assert(take, "This recording is not yours to review.", 403);
        if (a.decision === "keep") {
          assert(
            take.reviewStatus !== "discarded",
            "Restore this recording before keeping it.",
            409,
          );
          if ((take.reviewStatus ?? "kept") === "kept")
            return { takeId: take.id, status: "kept" };
          for (const previous of state.takes)
            if (
              previous.songId === songId &&
              (previous.id === take.replacesTakeId ||
                (previous.parentTakeId === take.replacesTakeId &&
                  !!take.replacesTakeId))
            )
              previous.active = false;
          take.reviewStatus = "kept";
          take.active = true;
        } else if (a.decision === "discard") {
          assert(
            take.reviewStatus === "draft" || take.reviewStatus === "discarded",
            "Only an unconfirmed recording can be discarded here.",
            409,
          );
          take.reviewStatus = "discarded";
          take.active = false;
        } else {
          assert(
            take.reviewStatus === "discarded" || take.reviewStatus === "draft",
            "This recording is already kept.",
            409,
          );
          for (const other of state.takes)
            if (
              other.id !== take.id &&
              other.songId === songId &&
              other.actor === actorId &&
              other.reviewStatus === "draft"
            )
              other.reviewStatus = "discarded";
          take.reviewStatus = "draft";
          take.active = false;
        }
        return { takeId: take.id, status: take.reviewStatus };
      }
      if (name === "generate_harmony") {
        this.member(state, actorId, songId);
        const take = state.takes.find(
          (t) =>
            t.id === a.takeId &&
            t.songId === songId &&
            t.source !== "generated-harmony" &&
            (t.reviewStatus ?? "kept") === "kept",
        );
        assert(take, "Keep your recording before generating harmony.", 409);
        const options = {
          direction: a.direction as "higher" | "lower",
          interval: a.interval as 3 | 5 | 6,
        };
        const fingerprint = `harmony-v2:${take.id}:${options.direction}:${options.interval}`;
        const previous = state.mixes.find(
          (m) => m.fingerprint === fingerprint && m.status !== "failed",
        );
        if (previous) return { jobId: previous.id, status: previous.status };
        const job = {
          id: randomUUID(),
          songId,
          actor: actorId,
          kind: "harmony" as const,
          sourceTakeId: take.id,
          harmonyOptions: options,
          status: "queued" as const,
          tracks: [structuredClone(take)],
          createdAt: iso(),
          fingerprint,
        };
        state.mixes.push(job);
        return { jobId: job.id, status: job.status };
      }
      if (name === "start_recording_session") {
        this.member(state, actorId, songId);
        assert(
          state.takes.filter((t) => t.songId === songId).length < 40,
          "This demo song has reached its take limit. Create another song.",
        );
        const references = a.referenceTakeIds
          ? this.selectedTracks(
              state,
              actorId,
              songId,
              a.referenceTakeIds as string[],
            )
          : [];
        let replacesTakeId = a.replacesTakeId as string | undefined;
        if (replacesTakeId)
          assert(
            state.takes.some(
              (t) =>
                t.id === replacesTakeId &&
                t.actor === actorId &&
                t.songId === songId &&
                t.source !== "generated-harmony" &&
                (t.reviewStatus ?? "kept") === "kept",
            ),
            "Only your own kept voice track can be replaced.",
            403,
          );
        if (!a.addTrack && !replacesTakeId)
          replacesTakeId = state.takes.findLast(
            (t) =>
              t.songId === songId &&
              t.actor === actorId &&
              t.part === a.part &&
              t.source !== "generated-harmony" &&
              t.active &&
              (t.reviewStatus ?? "kept") === "kept",
          )?.id;
        const session = {
          id: randomUUID(),
          actor: actorId,
          songId,
          part: a.part as "lead" | "harmony",
          expires: Date.now() + 10 * 60 * 1000,
          referenceTakeIds: references.map((t) => t.id),
          replacesTakeId,
        };
        state.recordings = state.recordings.filter(
          (r) => r.expires > Date.now(),
        );
        state.recordings.push(session);
        return {
          sessionId: session.id,
          part: session.part,
          referenceTakeIds: session.referenceTakeIds,
          expiresAt: new Date(session.expires).toISOString(),
          duration: RECORDING_SECONDS,
        };
      }
      if (name === "set_track_mix") {
        const song = this.member(state, actorId, songId);
        const take = state.takes.find(
          (t) => t.id === a.takeId && t.songId === songId,
        );
        assert(take, "Take not found.", 404);
        assert(
          (take.reviewStatus ?? "kept") === "kept",
          "Review this recording before changing its mix.",
          409,
        );
        assert(
          actorId === song.owner || actorId === take.actor,
          "Only the singer or song owner can change this take.",
          403,
        );
        for (const key of [
          "name",
          "gain",
          "offsetMs",
          "muted",
          "active",
        ] as const)
          if (a[key] !== undefined) Object.assign(take, { [key]: a[key] });
        return { take: { ...take, url: this.assetUrl(take.file, actorId) } };
      }
      if (name === "create_mix") {
        this.member(state, actorId, songId);
        const tracks = a.takeIds
          ? this.selectedTracks(state, actorId, songId, a.takeIds as string[])
          : state.takes.filter(
              (t) =>
                t.songId === songId &&
                (t.reviewStatus ?? "kept") === "kept" &&
                t.active &&
                !t.muted &&
                t.gain > 0,
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
          kind: mix.kind,
          estimatedKey: mix.estimatedKey,
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
        // Upload is provisional. Selection changes only on explicit review.
        for (const take of state.takes)
          if (
            take.songId === current.songId &&
            take.actor === actorId &&
            take.part === current.part &&
            take.reviewStatus === "draft"
          )
            take.reviewStatus = "discarded";
        const take: Take = {
          id: randomUUID(),
          songId: current.songId,
          actor: actorId,
          part: current.part,
          ...audio,
          gain: 0.8,
          offsetMs: Math.round(offsetMs),
          muted: false,
          active: false,
          reviewStatus: "draft",
          createdAt: iso(),
          trackNumber: this.nextTrackNumber(state, current.songId),
          name: `${PEOPLE.find((p) => p.id === actorId)!.name} · ${current.part === "lead" ? "Voice" : "Sung harmony"}`,
          referenceTakeIds: current.referenceTakeIds,
          replacesTakeId: current.replacesTakeId,
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
    const take = state.takes.find((t) => t.file === file);
    if (take) {
      this.member(state, actorId, take.songId);
      assert(
        (take.reviewStatus ?? "kept") === "kept" || take.actor === actorId,
        "This draft belongs to another singer.",
        403,
      );
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
          let estimatedKey: string | undefined;
          let harmonyFile: string | undefined;
          if (mix.kind === "harmony") {
            const generated = await renderHarmony(
              mix.tracks[0].file,
              this.audioDir,
              mix.id,
              mix.harmonyOptions,
            );
            estimatedKey = generated.estimatedKey;
            harmonyFile = generated.file;
            const source = mix.tracks[0];
            mix.tracks.push({
              ...source,
              actor: mix.actor,
              createdAt: mix.createdAt,
              name: harmonyLabel(mix.harmonyOptions),
              harmonyOptions: mix.harmonyOptions ?? DEFAULT_HARMONY,
              referenceTakeIds: undefined,
              replacesTakeId: undefined,
              trackNumber: undefined,
              capture: undefined,
              id: `${mix.id}-generated`,
              file: harmonyFile,
              part: "harmony",
              gain: 0.45,
              source: "generated-harmony",
              parentTakeId: mix.sourceTakeId,
              reviewStatus: "kept",
              active: true,
            });
          }
          const file = await renderMix(mix.tracks, this.audioDir, mix.id);
          this.store.update((state) => {
            if (mix.kind === "harmony") {
              const generated = mix.tracks[1];
              generated.active =
                !mix.tracks[0].active ||
                !!state.takes.find((take) => take.id === mix.sourceTakeId)
                  ?.active;
              generated.trackNumber = this.nextTrackNumber(state, mix.songId);
              state.takes.push(generated);
            }
            Object.assign(
              state.mixes.find((m) => m.id === mix.id)!,
              {
                file,
                status: "ready",
                tracks: mix.tracks,
                estimatedKey,
                harmonyFile,
              },
            );
          });
        } catch (error) {
          this.store.update((state) => {
            Object.assign(
              state.mixes.find((m) => m.id === mix.id)!,
              {
                status: "failed",
                error:
                  error instanceof AppError
                    ? error.message
                    : "Audio rendering failed. Your recording is safe. Try again.",
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
