export type Actor = "alex" | "ben" | "mom";
export type Part = "lead" | "harmony";
export interface HarmonyOptions {
  direction: "higher" | "lower";
  interval: 3 | 5 | 6;
}
export const DEFAULT_HARMONY: HarmonyOptions = {
  direction: "lower",
  interval: 3,
};
export function harmonyLabel(options: HarmonyOptions = DEFAULT_HARMONY) {
  return `${options.direction === "higher" ? "High" : "Low"} ${options.interval === 3 ? "3rd" : options.interval === 5 ? "5th" : "6th"} harmony`;
}
export interface Person {
  id: Actor;
  name: string;
  color: string;
  subtitle: string;
}
export const PEOPLE: Person[] = [
  { id: "alex", name: "Alex", color: "#a95b42", subtitle: "The melody maker" },
  {
    id: "ben",
    name: "Ben",
    color: "#777755",
    subtitle: "The other half of the harmony",
  },
  {
    id: "mom",
    name: "Mom",
    color: "#9181a3",
    subtitle: "A very special listener",
  },
];
export interface Take {
  id: string;
  songId: string;
  actor: Actor;
  part: Part;
  file: string;
  duration: number;
  sampleRate: number;
  gain: number;
  offsetMs: number;
  muted: boolean;
  active: boolean;
  createdAt: string;
  source: "microphone" | "sample-tone" | "generated-harmony";
  reviewStatus?: "draft" | "kept" | "discarded";
  parentTakeId?: string;
  trackNumber?: number;
  name?: string;
  harmonyOptions?: HarmonyOptions;
  referenceTakeIds?: string[];
  replacesTakeId?: string;
  capture?: {
    firstFrame: number;
    scheduledFrame: number;
    sampleRate: number;
    baseLatency: number;
    outputLatency: number;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
}
export interface Song {
  id: string;
  title: string;
  owner: Actor;
  members: Actor[];
  createdAt: string;
}
export interface Mix {
  id: string;
  songId: string;
  actor: Actor;
  status: "queued" | "running" | "ready" | "failed";
  tracks: Take[];
  createdAt: string;
  file?: string;
  error?: string;
  fingerprint: string;
  kind?: "harmony";
  sourceTakeId?: string;
  estimatedKey?: string;
  harmonyFile?: string;
  harmonyOptions?: HarmonyOptions;
}
export interface Surprise {
  id: string;
  songId: string;
  mixId: string;
  sender: Actor;
  recipient: Actor;
  message: string;
  createdAt: string;
  openedAt?: string;
  playedAt?: string;
}
export interface Confirmation {
  id: string;
  actor: Actor;
  songId: string;
  mixId: string;
  recipient: Actor;
  message: string;
  expires: number;
  acceptedAt?: string;
  surpriseId?: string;
}
export interface RecordingSession {
  id: string;
  actor: Actor;
  songId: string;
  part: Part;
  expires: number;
  takeId?: string;
  referenceTakeIds?: string[];
  replacesTakeId?: string;
}
export interface Trace {
  id: string;
  actor: Actor;
  name: string;
  at: string;
  durationMs: number;
  ok: boolean;
  summary: string;
}
export interface State {
  songs: Song[];
  takes: Take[];
  mixes: Mix[];
  surprises: Surprise[];
  confirmations: Confirmation[];
  recordings: RecordingSession[];
  traces: Trace[];
  idempotency: Record<string, { payload: string; id: string }>;
}
export interface SongView extends Song {
  takes: (Take & { url: string })[];
  mixes: (Mix & { url?: string })[];
}
export interface Bootstrap {
  actor: Actor;
  people: Person[];
  songs: SongView[];
  surprises: (Surprise & {
    title: string;
    contributors: string[];
    containsSamples: boolean;
    containsGeneratedHarmony?: boolean;
  })[];
  traces: Trace[];
  agentMode: "bedrock" | "scripted";
  protocol: string;
  recordingSeconds: number;
}
export type ToolResult = Record<string, unknown>;
export interface AgentResponse {
  text: string;
  mode: "bedrock" | "scripted";
  degraded?: boolean;
  action?:
    | {
        type: "record";
        part: Part;
        sessionId: string;
        referenceTakeIds?: string[];
      }
    | { type: "play_tracks"; takeIds: string[] }
    | { type: "review"; takeId: string }
    | { type: "mix"; jobId: string }
    | { type: "share"; confirmationId: string }
    | { type: "reveal"; surpriseId: string; url: string }
    | { type: "song"; songId: string };
}
