import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assert } from "./security.ts";
import type { Take } from "../shared/types.ts";

const exec = promisify(execFile);
export async function normalizeUpload(
  bytes: Buffer,
  directory: string,
): Promise<{ file: string; duration: number; sampleRate: number }> {
  assert(
    bytes.length > 44 && bytes.length <= 8 * 1024 * 1024,
    "Recording must be a WAV file under 8 MB.",
  );
  assert(
    bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WAVE",
    "Please upload a PCM WAV recording.",
  );
  const raw = path.join(directory, `${randomUUID()}.upload`);
  const file = `${randomUUID()}.wav`;
  const target = path.join(directory, file);
  writeFileSync(raw, bytes, { mode: 0o600 });
  try {
    const { stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", raw],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    const duration = Number(JSON.parse(stdout).format?.duration);
    assert(
      Number.isFinite(duration) && duration >= 0.25 && duration <= 30,
      "Record between 0.25 and 30 seconds.",
    );
    await exec(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        raw,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        target,
      ],
      { timeout: 15000 },
    );
    return { file, duration, sampleRate: 48000 };
  } finally {
    unlinkSync(raw);
  }
}

export function trackFilter(
  take: Pick<Take, "offsetMs" | "gain">,
  inputIndex: number,
): string {
  const shift =
    take.offsetMs >= 0
      ? `adelay=${Math.round(take.offsetMs)}:all=1`
      : `atrim=start=${(-take.offsetMs / 1000).toFixed(6)},asetpts=PTS-STARTPTS`;
  return `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=mono,${shift},volume=${take.gain}[t${inputIndex}]`;
}
export async function renderMix(
  tracks: Take[],
  directory: string,
  id: string,
): Promise<string> {
  assert(
    tracks.length > 0 && tracks.length <= 8,
    "Choose between one and eight audible takes.",
  );
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const take of tracks) args.push("-i", path.join(directory, take.file));
  const filters = tracks.map(trackFilter);
  filters.push(
    `${tracks.map((_, i) => `[t${i}]`).join("")}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.9:latency=1[out]`,
  );
  const file = `${id}.wav`;
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-t",
    "32",
    "-c:a",
    "pcm_s16le",
    path.join(directory, file),
  );
  await exec("ffmpeg", args, { timeout: 30000, maxBuffer: 1024 * 1024 });
  return file;
}
export function readPcmWav(file: string) {
  return readFileSync(file);
}
