# HarmonyMate

**Sing a little. Hear the harmony.**

Sing any familiar, unaccompanied phrase for up to 30 seconds. Listen to the recording, explicitly keep it or sing again, then choose high or low thirds, perfect fifths or diatonic sixths made from a recorded voice. Every original, generated harmony and human overdub is an independent numbered track. Download the result or confirm an exact version as a musical gift.

The Alexa+ experience is **simulated**. Browser microphone recording, persistent drafts, real HTTP MCP calls, authorization, local pitch analysis, audio processing and ffmpeg mixing are implemented. Echo recording and Alexa account linking are not connected.

## Video walkthrough

[Watch or download the 2:08 introduction](docs/video/HarmonyMate-walkthrough.mp4) · [English subtitles](docs/video/HarmonyMate-walkthrough.en.srt).

This edited screenshot walkthrough uses synthetic English narration and describes the implemented browser flow. It does not include audible singing or harmony output, and is not a continuous recording or a demonstration of real Alexa hardware. See [video notes and reproducible build instructions](docs/video/README.md).

## Run locally

Requirements: Node.js >=22.13 (24 LTS recommended), npm, `ffmpeg` and `ffprobe` on PATH. Node's SQLite may print an experimental warning.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open the URL printed in the terminal (default [localhost:3000](http://127.0.0.1:3000)). Set `PORT` in `.env` if another app uses that port. This workstation currently uses **3001**. No AWS account, external audio service or downloaded voice model is required.

For production, `npm run build` then `npm start`. Or use `docker compose up --build` with a running Docker daemon; Docker runtime verification remains environment-dependent.

## The experience

1. Enter as Alex without a login. Press **Record my part** and allow microphone access.
2. After a three-second count-in, sing a phrase you know without background music. Press **Finish take**, or let capture finish at 30 seconds. No guide melody, part selector or headphone checklist is required.
3. The recording becomes a **draft**, and the browser starts a preview. Choose **Keep this take**, **Sing again** or **Discard this take**. Stop/replay is always available. A draft never replaces the previous kept version, enters a mix or gets shared. Leaving/reloading preserves it for review.
4. Keeping an initial take explicitly selects it and queues a default low-third harmony. **Add a generated harmony** lets you choose the source recording, Higher/Lower, and 3rd/5th/6th. Every variant has its own file, track number and playback/download controls; requesting the same variant again reuses its job. Keeping a human overdub simply adds that track without generating another part. The original audio file is unchanged. When ready, choose **Listen with harmony** or **Original only**. Processing does not automatically start playback or send a gift.
5. Discard is reversible through **Undo** or **Your songs & earlier recordings**. Starting a new successful attempt archives the previous pending draft as discarded; a failed/cancelled attempt does not replace it. Earlier confirmed recordings remain available to listen to.
6. Select up to eight tracks, then **Play selected together**, **Sing with selected tracks** or **Save selected mix**. Overdub requires headphones: selected voices are scheduled with microphone capture in the same AudioContext, while only microphone PCM is uploaded as a new draft. The reference track IDs are preserved. Kept overdubs add a new voice; retakes replace only their declared source selection. Every kept track, including earlier versions, stays individually playable. Expand track settings to rename a track or adjust volume/manual timing.
7. The result is saved without another step. Download it, or optionally choose **Make a gift**, review the recipient/note/exact version and confirm sending to Mom's inbox.

Switch freely between Alex, Ben and Mom with **Demo singer**. These are demonstration roles, not private family identities. Drafts are only exposed to their singer; kept project takes can be accessed by authorized members. Demo profile switching is not production authentication. Use test material.

Text commands and optional English/Traditional Chinese browser speech input support requests such as “what tracks do I have?”, “play tracks 1 and 3”, “sing with track 1”, “make high sixth harmony from track 1”, “play original and low third harmony”, “save a mix of tracks 1 and 2”, “keep”, “discard”, and “undo”. Chinese examples: 「目前有哪些音軌？」「播放第 1、3 軌」「跟第 1 軌一起唱」「幫第 1 軌加高六度和聲」「播放原唱跟低三度」. Stable track numbers are independent of list position; unknown/ambiguous tracks prompt clarification. The assistant uses the same authorized selection tools as the UI. Browser recording still requires a button click. Browser speech recognition may use the browser vendor's service; the song-processing pipeline itself runs locally. Spoken responses are opt-in. Conversation defaults to scripted intent handling; `BEDROCK_MODEL_ID` and standard AWS credentials optionally enable Converse tool use, which still needs validation with a real AWS account.

## How the harmony is made

This is **local DSP, not a generative AI singer or voice-cloning service**:

- Normalize the recording to 48 kHz mono PCM.
- Detect single-voice pitch with a YIN-style difference function every 20 ms.
- Estimate a major/minor key from the sung pitch distribution.
- Choose high/low diatonic thirds (three or four semitones), perfect fifths (seven semitones), or diatonic sixths (eight or nine semitones), smooth note transitions and gate unvoiced regions.
- Transpose the needed copies using stock ffmpeg `asetrate`/`aresample`/`atempo`, blend according to the detected notes, and mix a quieter harmony with the original.

Short, clean, unaccompanied phrases work best. Key estimation is ambiguous for short melodies, changing keys or chromatic singing. Pitch shifting changes vocal timbre and can sound synthetic; atempo can smear consonants and note boundaries. It does not understand lyrics, infer chords from accompaniment, arrange arbitrary songs or guarantee musical correctness. If no clear pitched singing is detected, generation reports an error while preserving the recording. Original-only playback and retry remain available.

Synthetic tests establish musical interval changes, preserved sample duration and non-destructive source handling. Physical singing quality, microphone acoustics and speaker-only rehearsal require listening tests with actual users/devices.

## Architecture and MCP

```text
React / Web Audio / AudioWorklet
  → provisional WAV upload → explicit take review
  → authenticated MCP generate_harmony → persisted background job
  → pitch analysis + ffmpeg → immutable source/harmony mix
  → optional confirmed musical gift
```

Thirteen official-SDK MCP tools use authenticated stateless Streamable HTTP at `POST /mcp`, negotiating protocol `2025-11-25`:

| Tool | Purpose |
|---|---|
| `create_song` | Idempotent project creation |
| `get_song` | Authorized project, takes and immutable mixes |
| `list_tracks` | Kept tracks with stable numbers, names, provenance and individual audio URLs |
| `play_tracks` | Validate and return exactly the requested track IDs for combined browser playback |
| `start_recording_session` | Actor-bound recording/overdub session with exact reference IDs and optional replacement target |
| `review_take` | Explicit keep, reversible discard or restore |
| `generate_harmony` | Queue/idempotently reuse a high/low 3rd/5th/6th variant for a kept original voice |
| `get_mix_status` | Background job status and finished playback URL |
| `set_track_mix` | Advanced control of previously kept takes |
| `create_mix` | Immutable mix of explicit take IDs, or active kept tracks by default |
| `create_surprise` | Prepare or commit an explicitly UI-confirmed fixed-version gift |
| `list_surprises` | Recipient inbox |
| `reveal_surprise` | Recipient-only opening and temporary playback URL |

`get_harmony_guide` has been removed. The original tone-rendering utility and labeled `/sample` upload route remain only for automated pipeline fixtures; the product does not suggest a melody.

SQLite and private files live under `.data/`. Run one process/instance per data directory. Jobs are persisted, failed jobs can be retried, and ready results remain bound to their original source recording. Existing stored recordings without a review field are treated as previously kept for compatibility. Old gifts stay immutable. Draft/discarded audio is private to its singer. Audio URLs expire after five minutes and recheck access. Uploads are bounded to 8 MB / 30 seconds and actor-bound/idempotent. Demo MCP tokens are server-signed and not publicly issued to browsers; this does not implement Alexa OAuth account linking.

## Verification

```sh
npm run check
npm test
npm run build
# With the app running:
npm run smoke
```

Tests additionally verify all six pitch options against known note frequencies, independent stem access, stable track numbers, legacy stem migration, exact-subset mixes, bilingual track commands, rejected unknown/ambiguous tracks, and headphones overdub scheduling with microphone-only PCM upload. Tests cover direct entry, role switching, real HTTP MCP, denied/retried/cancelled microphone setup, PCM upload, draft review/undo, no generation before acceptance, draft privacy, mix/share authorization, preserved original files and gifts after retakes, idempotent generation, actual ffmpeg output, changing diatonic intervals, identical source/output sample duration, quiet rests and silence rejection. Synthetic AudioWorklet tests check sample alignment, not physical latency.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Loopback bind |
| `DATA_DIR` | `.data` | Persistent storage |
| `SESSION_SECRET` | Generated locally | Token signing |
| `BEDROCK_MODEL_ID` | Empty | Optional Converse conversation |
| `AWS_REGION` | `eu-central-1` | Optional AWS region |
| `PUBLIC_ORIGIN` | Local request origin | Exact external HTTPS origin |

This is not publicly deployed. Hosting requires HTTPS for browser microphone access, persistent single-instance storage, proper identity and explicit origin configuration. Bedrock, Docker runtime and Alexa hardware are not established by local synthetic tests.

## Licenses and history

Code and the original instrumental test exercise: MIT. Users choose what they sing; the app does not distribute a song catalog or third-party backing tracks. React, Vite, Express, Zod, Lucide, tsx and MCP SDK retain their licenses; AWS SDK is Apache-2.0; bundled fonts are SIL OFL. ffmpeg licensing depends on its build.

The project was developed for Build, Ship, Shape: Amazon Developer Hackathon 2026. Earlier plans and friction notes describe the original curated-melody/two-singer prototype and are historical: [plan](docs/HARMONYMATE_PLAN.md), [official checks](OFFICIAL_SOURCE_CHECK.md), [friction log](FRICTION.md). See [current implementation status](docs/IMPLEMENTATION_STATUS.md).
