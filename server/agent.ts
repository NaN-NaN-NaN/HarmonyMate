import { randomUUID } from "node:crypto";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ToolConfiguration,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
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
  ): Promise<AgentResponse> {
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
    return this.scripted(actor, text, songId);
  }
  private action(name: ToolName, result: ToolResult): AgentResponse["action"] {
    if (name === "create_song")
      return { type: "song", songId: (result.song as { id: string }).id };
    if (name === "get_harmony_guide")
      return {
        type: "guide",
        part: result.part as Part,
        url: String(result.url),
      };
    if (name === "start_recording_session")
      return {
        type: "record",
        part: result.part as Part,
        sessionId: String(result.sessionId),
      };
    if (name === "create_mix")
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
  ): Promise<AgentResponse> {
    const context = this.harmony.bootstrap(actor);
    const song =
      context.songs.find((s) => s.id === requestedSong) ?? context.songs[0];
    const t = text.toLowerCase();
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
    if (/surprise|gift|驚喜|禮物/.test(t) && actor === "mom") {
      const result = await this.tools.call(actor, "list_surprises", {});
      return reply(
        (result.surprises as unknown[]).length
          ? "There’s a little song waiting for you. Open your inbox and choose “Listen to my surprise”."
          : "No musical gifts yet. Something lovely may be on its way.",
      );
    }
    if (
      /listen|play|hear|播放|聽/.test(t) &&
      actor === "mom" &&
      context.surprises.length
    ) {
      return call(
        "reveal_surprise",
        { surpriseId: context.surprises[0].id },
        "This one is just for you. Let’s listen.",
      );
    }
    if (/new song|create|start over|建立|新歌/.test(t))
      return call(
        "create_song",
        { title: "A little closer", idempotencyKey: randomUUID() },
        "A fresh little song. Let’s hear the melody, then make it yours.",
      );
    if (!song)
      return reply(
        "Open your inbox to hear a musical gift, or create a new song to start singing.",
      );
    if (/send|share|save.*mom|surprise|gift|送|分享/.test(t)) {
      const mix = song.mixes.findLast((m) => m.status === "ready");
      if (!mix)
        return reply(
          "Let’s record and make a mix first. Then you can send it to Mom.",
        );
      return call(
        "create_surprise",
        {
          songId: song.id,
          mixId: mix.id,
          recipient: "mom",
          message: "A little song, from us to you.",
        },
        "A song for Mom. Review this version and confirm when you’re ready.",
      );
    }
    if (/together|mix|合起|混音|一起聽/.test(t))
      return call(
        "create_mix",
        { songId: song.id },
        "Bringing your voices together. Your original takes will stay just as they are.",
      );
    if (/record|ready|錄|準備好/.test(t))
      return call(
        "start_recording_session",
        {
          songId: song.id,
          part:
            /harmony|lower|和聲/.test(t) || actor === "ben"
              ? "harmony"
              : "lead",
        },
        "Put on wired headphones. Your recording card is ready when you are.",
      );
    if (/harmony|lower|ben|和聲/.test(t))
      return call(
        "get_harmony_guide",
        { songId: song.id, part: "harmony" },
        "Here’s the lower part. Listen once, then try humming along.",
      );
    if (/quieter|softer|小聲/.test(t)) {
      const take = song.takes.findLast((t) => t.actor === actor && t.active);
      if (!take)
        return reply("Record your first take, and I can help balance it.");
      return call(
        "set_track_mix",
        {
          songId: song.id,
          takeId: take.id,
          gain: Math.max(0, take.gain - 0.15),
        },
        "A little softer. Make a new mix when it feels right.",
      );
    }
    if (/sing|melody|lead|play|listen|again|唱|旋律|再一次/.test(t))
      return call(
        "get_harmony_guide",
        { songId: song.id, part: "lead" },
        "Let’s sing “A little closer”. Start with this short melody. There’s no need to get it perfect.",
      );
    return reply(
      "Try “I feel like singing”, “Teach me the lower harmony”, “Record my part”, or “Let us hear it together”.",
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
      tools: (Object.keys(schemas) as ToolName[]).map((name) => ({
        toolSpec: {
          name,
          description: descriptions[name],
          inputSchema: { json: z.toJSONSchema(schemas[name]) as never },
        },
      })),
    };
    const messages: Message[] = [{ role: "user", content: [{ text }] }];
    const system = `You are HarmonyMate, a warm, concise singing companion in a clearly labeled Alexa+ simulator. Reply in at most two short sentences, in the user's language. You help humans sing; the guides are curated instrumental tones, never AI-generated vocals. No native Echo microphone, identity or notifications. User=${actor}. Active song=${active?.id ?? "none"}. Accessible songs=${JSON.stringify(context.songs.map((s) => ({ id: s.id, title: s.title, takes: s.takes.map((t) => ({ id: t.id, actor: t.actor, active: t.active })), readyMixes: s.mixes.filter((m) => m.status === "ready").map((m) => m.id) })))}. Recipient inbox IDs=${JSON.stringify(context.surprises.map((s) => s.id))}. Use tools for actual actions, never claim an action without success. For 'I feel like singing', retrieve the lead guide. For harmony retrieve harmony guide. To record prepare a recording session (the user must press the recording button). To hear voices together create a mix. To share call create_surprise WITHOUT confirmationId, then tell user to review the UI card. Only the user UI accepts confirmations; do not ask tools to manufacture approval. Never reveal a gift unless this user asks to listen. An idempotencyKey for a new song can be '${randomUUID()}'.`;
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
