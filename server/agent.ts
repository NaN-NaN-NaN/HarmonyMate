import { randomUUID } from "node:crypto";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ToolConfiguration,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { trackIntent } from "./track-commands.ts";
import { harmonyLabel } from "../shared/types.ts";
import {
  descriptions,
  schemas,
  type ToolName,
  type Harmony,
} from "./domain.ts";
import type { ToolClient } from "./mcp.ts";
import type {
  Actor,
  AgentResponse,
  Part,
  ToolResult,
} from "../shared/types.ts";

export class Agent {
  readonly bedrock = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "eu-central-1",
    maxAttempts: 1,
  });
  constructor(
    readonly harmony: Harmony,
    readonly tools: ToolClient,
  ) {}
  async respond(
    actor: Actor,
    text: string,
    songId?: string,
    selectedTakeIds: string[] = [],
  ): Promise<AgentResponse> {
    const context = this.harmony.bootstrap(actor);
    const active =
      context.songs.find((s) => s.id === songId) ?? context.songs[0];
    if (active && trackIntent(text, active.takes, actor, selectedTakeIds))
      return this.scripted(actor, text, songId, selectedTakeIds);
    if (
      /^(keep( this( take)?)?|留[下著這]*|留下這次|discard( this( take)?)?|捨棄|不要了|restore|復原|undo)[.!。！]?$/i.test(
        text.trim(),
      )
    )
      return this.scripted(actor, text, songId, selectedTakeIds);
    if (process.env.BEDROCK_MODEL_ID) {
      try {
        return await this.converse(actor, text, songId);
      } catch (error) {
        console.warn(
          "Bedrock unavailable:",
          error instanceof Error ? error.name : "unknown",
        );
        // Never replay a turn after it may have mutated state. The caller can retry explicitly.
        return {
          text: "The AI connection is unavailable. Your recordings are safe. Use the studio buttons, or try again.",
          mode: "scripted",
          degraded: true,
        };
      }
    }
    return this.scripted(actor, text, songId, selectedTakeIds);
  }
  private action(name: ToolName, result: ToolResult): AgentResponse["action"] {
    if (name === "create_song")
      return { type: "song", songId: (result.song as { id: string }).id };
    if (name === "start_recording_session")
      return {
        type: "record",
        part: result.part as Part,
        sessionId: String(result.sessionId),
        referenceTakeIds: result.referenceTakeIds as string[] | undefined,
      };
    if (name === "play_tracks")
      return { type: "play_tracks", takeIds: result.takeIds as string[] };
    if (name === "create_mix" || name === "generate_harmony")
      return { type: "mix", jobId: String(result.jobId) };
    if (name === "create_surprise" && result.requiresConfirmation)
      return { type: "share", confirmationId: String(result.confirmationId) };
    if (name === "reveal_surprise")
      return {
        type: "reveal",
        surpriseId: (result.surprise as { id: string }).id,
        url: String(result.url),
      };
  }
  private async scripted(
    actor: Actor,
    text: string,
    requestedSong?: string,
    selectedTakeIds: string[] = [],
  ): Promise<AgentResponse> {
    const context = this.harmony.bootstrap(actor);
    const song =
      context.songs.find((s) => s.id === requestedSong) ?? context.songs[0];
    const t = text.trim().toLowerCase();
    const reply = (
      text: string,
      action?: AgentResponse["action"],
    ): AgentResponse => ({ text, action, mode: "scripted" });
    const call = async (
      name: ToolName,
      args: Record<string, unknown>,
      message: string,
    ) => {
      const result = await this.tools.call(actor, name, args);
      return reply(message, this.action(name, result));
    };
    if (actor === "mom") {
      if (/play|listen|播放|聽/.test(t) && context.surprises.length)
        return call(
          "reveal_surprise",
          { surpriseId: context.surprises[0].id },
          "Let’s listen.",
        );
      const result = await this.tools.call(actor, "list_surprises", {});
      return reply(
        (result.surprises as unknown[]).length
          ? "There’s a song waiting in your inbox."
          : "No musical gifts yet.",
      );
    }
    if (/new song|create|start over|新歌|建立/.test(t))
      return call(
        "create_song",
        { title: "Untitled song", idempotencyKey: randomUUID() },
        "Sing any short phrase you know. Your recording card is ready.",
      );
    if (!song) return reply("Create a song to start singing.");
    const draft = song.takes.findLast(
      (take) => take.actor === actor && take.reviewStatus === "draft",
    );
    const kept = song.takes.findLast(
      (take) =>
        take.actor === actor &&
        take.source !== "generated-harmony" &&
        take.active &&
        (take.reviewStatus ?? "kept") === "kept",
    );
    if (/^(keep( this( take)?)?|留下|留下這次)[.!。！]?$/.test(t)) {
      if (!draft) return reply("There’s no new recording to review.");
      await this.tools.call(actor, "review_take", {
        songId: song.id,
        takeId: draft.id,
        decision: "keep",
      });
      return call(
        "generate_harmony",
        { songId: song.id, takeId: draft.id },
        "Kept. I’m making a lower harmony from your voice.",
      );
    }
    if (/^(discard( this( take)?)?|捨棄|不要了)[.!。！]?$/.test(t)) {
      if (!draft) return reply("There’s no new recording to discard.");
      await this.tools.call(actor, "review_take", {
        songId: song.id,
        takeId: draft.id,
        decision: "discard",
      });
      return reply(
        "Discarded. Your last kept recording is safe. Say ‘undo’ to restore this draft.",
      );
    }
    if (/^(restore|undo|復原)[.!。！]?$/.test(t)) {
      const discarded = song.takes.findLast(
        (take) => take.actor === actor && take.reviewStatus === "discarded",
      );
      if (!discarded)
        return reply("There’s no discarded recording to restore.");
      await this.tools.call(actor, "review_take", {
        songId: song.id,
        takeId: discarded.id,
        decision: "restore",
      });
      return reply("Restored for review.", {
        type: "review",
        takeId: discarded.id,
      });
    }
    const intent = trackIntent(text, song.takes, actor, selectedTakeIds);
    const zh = /[\u3400-\u9fff]/.test(text);
    if (intent?.type === "list") {
      const result = await this.tools.call(actor, "list_tracks", {
        songId: song.id,
      });
      const tracks = result.tracks as typeof song.takes;
      return reply(
        tracks.length
          ? (zh ? "目前的音軌：\n" : "Your tracks:\n") +
              tracks
                .map(
                  (take) =>
                    `#${take.trackNumber} ${take.name} (${take.source === "generated-harmony" ? (zh ? "生成和聲" : "generated") : zh ? "錄音" : "recorded"}${!take.active ? (zh ? "，先前版本" : ", earlier version") : ""})`,
                )
                .join("\n") +
              (zh
                ? "\n可以說「播放第 1、2 軌」或「跟第 1 軌一起唱」。"
                : "\nTry ‘play tracks 1 and 2’ or ‘sing with track 1’.")
          : zh
            ? "還沒有已留下的音軌。先錄一段並確認留下。"
            : "No kept tracks yet. Record and keep a phrase first.",
      );
    }
    if (intent?.type === "error") return reply(intent.message);
    if (intent?.type === "play")
      return call(
        "play_tracks",
        { songId: song.id, takeIds: intent.takeIds },
        zh ? "播放指定音軌。" : "Playing your selected tracks.",
      );
    if (intent?.type === "overdub")
      return call(
        "start_recording_session",
        {
          songId: song.id,
          part: "harmony",
          addTrack: true,
          referenceTakeIds: intent.takeIds,
        },
        zh
          ? "已選好伴唱音軌。戴上耳機，再按錄音；你的聲音會存成獨立一軌。"
          : "Your reference tracks are selected. Put on headphones, then press record to add a separate voice track.",
      );
    if (intent?.type === "mix")
      return call(
        "create_mix",
        { songId: song.id, takeIds: intent.takeIds },
        zh
          ? "正在保存指定音軌的混音。"
          : "Saving a mix of exactly those tracks.",
      );
    if (intent?.type === "generate") {
      if (draft)
        return reply(
          zh
            ? "請先決定新錄音要留下或捨棄。"
            : "Keep or discard your new recording first.",
          { type: "review", takeId: draft.id },
        );
      return call(
        "generate_harmony",
        { songId: song.id, takeId: intent.takeId, ...intent.options },
        zh
          ? `正在產生${intent.options.direction === "higher" ? "高" : "低"}${intent.options.interval}度和聲。`
          : `Making ${harmonyLabel(intent.options).toLowerCase()}.`,
      );
    }
    if (/send|share|gift|surprise|送|分享|禮物/.test(t)) {
      if (draft)
        return reply("Keep or discard your new recording first.", {
          type: "review",
          takeId: draft.id,
        });
      const mix = song.mixes.findLast(
        (m) =>
          m.status === "ready" &&
          (m.kind !== "harmony" || m.sourceTakeId === kept?.id),
      );
      if (!mix) return reply("Keep a recording and finish its harmony first.");
      return call(
        "create_surprise",
        {
          songId: song.id,
          mixId: mix.id,
          recipient: "mom",
          message: "A little song, from me to you.",
        },
        "Review this version and recipient before sending.",
      );
    }
    if (/harmony|together|mix|和聲|一起聽|混音/.test(t)) {
      if (draft)
        return reply("Listen to your recording, then keep it or sing again.", {
          type: "review",
          takeId: draft.id,
        });
      if (!kept)
        return reply("Sing a short phrase first. No guide melody needed.");
      return call(
        "generate_harmony",
        { songId: song.id, takeId: kept.id },
        "I’m making a lower harmony from your voice.",
      );
    }
    if (/listen|play|hear|聽|播放/.test(t) && draft)
      return reply("Here’s your recording. Keep it or sing again.", {
        type: "review",
        takeId: draft.id,
      });
    if (/sing|record|ready|again|唱|錄|重來|準備/.test(t))
      return call(
        "start_recording_session",
        { songId: song.id, part: "lead" },
        "Sing any short phrase. Press record when you’re ready.",
      );
    return reply(
      "Try ‘record my voice’, ‘keep’, ‘sing again’, or ‘make harmony’.",
    );
  }
  private async converse(
    actor: Actor,
    text: string,
    songId?: string,
  ): Promise<AgentResponse> {
    const context = this.harmony.bootstrap(actor);
    const active =
      context.songs.find((s) => s.id === songId) ?? context.songs[0];
    const tools: ToolConfiguration = {
      tools: (Object.keys(schemas) as ToolName[])
        .filter((name) => name !== "review_take")
        .map((name) => ({
          toolSpec: {
            name,
            description: descriptions[name],
            inputSchema: { json: z.toJSONSchema(schemas[name]) as never },
          },
        })),
    };
    const messages: Message[] = [{ role: "user", content: [{ text }] }];
    const system = `You are HarmonyMate, a concise singing companion. Reply in the user's language in at most two short sentences. Users sing any unaccompanied phrase up to 30 seconds, review it, explicitly keep or discard it, then generate_harmony offers high/low thirds, perfect fifths and diatonic sixths as independent tracks. list_tracks lists stable track numbers, play_tracks plays the exact selection, and start_recording_session with referenceTakeIds and addTrack=true prepares headphones overdubbing. create_mix accepts exact takeIds. This is pitch-shifted recorded voice, not an AI voice model. No melody guides. No Echo microphone connection. User=${actor}. Active song=${active?.id ?? "none"}. Context=${JSON.stringify(context.songs)}. Never keep/discard without user action; review buttons or explicit keep/discard commands handle this. Drafts cannot be mixed. For recording prepare start_recording_session; the user presses record. For harmony only use a kept active recording owned by the user. Never invent audio or imply harmony is ready before get_mix_status says ready. For sharing, create_surprise without confirmationId and direct the user to the UI confirmation. Never accept sharing on their behalf. New song idempotencyKey=${randomUUID()}.`;

    let action: AgentResponse["action"];
    for (let round = 0; round < 4; round++) {
      const response = await this.bedrock.send(
        new ConverseCommand({
          modelId: process.env.BEDROCK_MODEL_ID,
          messages,
          system: [{ text: system }],
          toolConfig: tools,
          inferenceConfig: { maxTokens: 450, temperature: 0.2 },
        }),
        { abortSignal: AbortSignal.timeout(18000) },
      );
      const output = response.output?.message;
      if (!output) throw new Error("No model response");
      messages.push(output);
      const calls =
        output.content?.flatMap((block) =>
          block.toolUse ? [block.toolUse] : [],
        ) ?? [];
      if (!calls.length)
        return {
          text:
            output.content
              ?.map((b) => b.text ?? "")
              .join("")
              .trim() || "Ready when you are.",
          action,
          mode: "bedrock",
        };
      const blocks = [];
      for (const call of calls.slice(0, 4)) {
        let content: ToolResultContentBlock[];
        let status: "success" | "error" = "success";
        try {
          if (!call.name || !(call.name in schemas))
            throw new Error("Unknown tool");
          const name = call.name as ToolName;
          // Models cannot commit shares, even if they invent a confirmation ID.
          const args = { ...(call.input as Record<string, unknown>) };
          if (name === "create_surprise") delete args.confirmationId;
          if (name === "review_take")
            throw new Error("Use explicit review controls.");
          const result = await this.tools.call(actor, name, args);
          action = this.action(name, result) ?? action;
          content = [{ json: result as never }];
        } catch (error) {
          status = "error";
          content = [
            { text: error instanceof Error ? error.message : "Tool failed" },
          ];
        }
        blocks.push({
          toolResult: { toolUseId: call.toolUseId, content, status },
        });
      }
      messages.push({ role: "user", content: blocks });
    }
    return {
      text: "Your studio is ready. Use the card to continue.",
      mode: "bedrock",
      action,
    };
  }
}
