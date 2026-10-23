# HarmonyMate

**A little guidance. Your voices, together.**

HarmonyMate turns a spontaneous “let’s sing” into a shared moment. Learn a short original melody, follow a lower harmony, record your own voice while listening to someone else, and save the result as a private musical gift.

A new project developed during the Build, Ship, Shape: Amazon Developer Hackathon 2026. The Alexa+ experience is **simulated**. Microphone recording, independent takes, MCP calls, persistence, authorization and ffmpeg mixing are real.

## Run locally

Requirements: **Node.js 24 LTS** (minimum 22.13), npm, `ffmpeg` and `ffprobe` on PATH. Node's built-in SQLite may print an experimental warning on some versions.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open [HarmonyMate](http://127.0.0.1:3000). No AWS or Supabase account is required for the local scripted simulator. The default server binds to loopback only.

For a production build:

```sh
npm run build
npm start
```

Or, with a running Docker daemon:

```sh
docker compose up --build
```

Docker installs ffmpeg and keeps data in a persistent volume. Compose exposes the app on localhost. Docker runtime verification is pending because this machine's daemon was unavailable; native build and tests passed.

## Demo profiles

The app opens immediately as **Alex**. Use the **Demo singer** selector to switch to **Ben** or **Mom**. No login or password is required; these are freely switchable demonstration roles, not production identities or Alexa household accounts.

- Alex owns the starter song, “A little closer”.
- Ben is a preauthorized contributor to the starter song and songs created by Alex. This fixture replaces invitation delivery in the MVP.
- Mom sees her surprise inbox, without access to Alex and Ben's projects or individual tracks.

The role selector is available at the bottom of the navigation, including on narrow screens. Use test material: anyone can select any demo role. Per-song/recipient checks still apply to the selected role, but this is not private user authentication.

## Try the recording workflow

1. Open the app as Alex. Choose **Record my voice**, or listen to **Melody** in the studio first.
2. Choose **Record my part** and allow the browser microphone. No headphone checkbox is required to start. A three-second count-in precedes the original 17-second exercise. Finish early with **Finish take**, or let it finish automatically. Permission setup can be cancelled; blocked, missing or busy microphones show a persistent explanation and retry instructions.
3. Switch to Ben with **Demo singer**, put on wired headphones, and enable **Play existing voices in my headphones** to overdub Alex's take. Optionally enable **Play my guide while I sing**. Playback is off by default so a first recording works without headphones and avoids speaker bleed. The microphone is stored separately from reference playback.
4. Preview voices, adjust volume or timing, and choose **Bring us together**. ffmpeg renders a saved mix in the background.
5. Switch to Alex; choose **Make a surprise for Mom**, review the recipient, note and exact mix version, then confirm.
6. Switch to Mom; choose **Listen to my surprise**. Opening and playback completion are recorded separately.

Retakes preserve original files, marking the previous take inactive. Existing mixes/gifts reference an immutable snapshot. Earlier takes can be played; a full version editor is deferred.

### Test without a microphone

Under **Recording settings**, choose **Add a sample guide tone for testing**. Add a melody as Alex and a harmony as Ben, then mix and send. Instrumental tracks are visibly labeled **SAMPLE GUIDE TONE**, including in the mix. This tests the pipeline, not human singing or acoustic synchronization.

**Check audio engine (no microphone)** runs a silent synthetic oscillator through the real browser AudioWorklet. It checks captured sample count and T0 alignment without requesting microphone access. It does not measure physical device latency.

## Conversation and voice

Type a command or use the microphone button for optional browser speech recognition. Buttons/text remain available. Spoken responses are opt-in using the speaker button.

Default: **Scripted simulator mode**. Examples:

- “I feel like singing.”
- “Teach me the lower harmony.”
- “Record my part.”
- “Let us hear it together.”
- “Make my voice quieter.”
- “Save this as a surprise for Mom.”
- As Mom: “Do I have a musical surprise?” / “Play my surprise.”

Commands prepare a recording card rather than silently activating the microphone. Sharing requires the UI confirmation. Command recognition and speech output stop during singing. Browser speech recognition may use the browser vendor's service; it is separate from raw song capture.

### Optional Amazon Bedrock

Set `BEDROCK_MODEL_ID` to a model supporting Converse tool use in the selected region, set `AWS_REGION`, and supply credentials through the standard SDK chain (profile, environment, or execution role). Credentials never enter browser code or model prompts.

The agent maps the actual MCP schemas to Bedrock Converse, executes selected tools over HTTP MCP, returns results, and produces short replies. Rounds, calls, retries and request duration are bounded. On AI failure an explicit degraded message appears; possibly completed writes are not silently replayed through scripted routing. Studio buttons continue to work.

Bedrock is implemented but **not verified against a live AWS account**; no model ID was configured. Do not claim runtime AWS usage without documenting a successful call. Polly is deferred; speech output uses browser TTS.

## Architecture

```text
React + Vite / Web Audio / AudioWorklet
  ├─ REST: authentication, WAV upload, explicit confirmations
  └─ /api/agent or /api/tools
          │
     Official SDK MCP client
          │ authenticated Streamable HTTP
     /mcp → validated tools → domain services
                               ├─ SQLite + private files
                               └─ persisted mix jobs → ffmpeg
```

One Express service serves frontend and backend. SQLite/private files deliberately replace the initial Supabase proposal for a reproducible demo without cloud credentials. This MVP supports **one process and one instance**. Do not run multiple instances against one data directory; managed storage and atomic job claiming are needed before scaling.

Data lives under `.data/`, excluded from Git and static serving. A random local session secret is generated with restrictive permissions unless configured. WAV uploads are normalized to 48 kHz mono; original capture frame/rate metadata is preserved separately. The original exercise is 112 BPM, C major, approximately 17 seconds.

One AudioContext schedules reference playback and PCM capture. Manual signed offsets are supported: positive delays, negative trims the beginning. Synthetic tests verify sample alignment; **physical input/output latency, bleed and real singers' timing require device rehearsal**. `baseLatency + outputLatency` is not treated as a complete round-trip measurement. Automatic hardware calibration is deferred.

## MCP

Endpoint: `POST /mcp`. **Streamable HTTP**, stateless JSON responses, official `@modelcontextprotocol/sdk` **1.32.1**. Tests initialize and verify protocol **2025-11-25**, then execute `tools/list` and `tools/call` through the SDK client.

| Tool | Purpose |
|---|---|
| `create_song` | Idempotent project creation |
| `get_song` | Authorized tracks, mixes and playback links |
| `get_harmony_guide` | Curated lead/lower harmony tone |
| `start_recording_session` | Expiring actor-bound browser recording session |
| `set_track_mix` | Gain, mute, signed offset, active selection |
| `create_mix` | Persist and queue real ffmpeg mixing |
| `get_mix_status` | Processing state and finished audio |
| `create_surprise` | Prepare share or commit a UI-accepted confirmation |
| `list_surprises` | Authenticated recipient's inbox |
| `reveal_surprise` | Recipient-only opening and temporary audio link |

All simulator tool operations, including scripted commands, cross real HTTP MCP. The activity page shows actual per-profile server tool execution; timings exclude network/agent time. Annotations describe tool behavior; domain authorization is independent of the model.

MCP accepts only short-lived server-signed demo Bearer tokens. Unauthenticated requests return 401 without `WWW-Authenticate`, matching Alexa+'s client-specific guidance. This is **demo auth**, not Alexa OAuth/account linking. MCP credentials are not issued through a public browser API; the local smoke script signs a temporary read-test token with the local secret.

Uploads are size/duration bounded, expiring, actor-bound and idempotent. ffprobe validates files. Audio URLs expire after five minutes and recheck access. Signed links are temporary bearer capabilities; do not redistribute them. Sharing binds to one mix and recipient. Model-supplied `confirmed: true` is rejected.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; Docker uses `0.0.0.0` internally |
| `DATA_DIR` | `.data` | Persistent private data directory |
| `SESSION_SECRET` | Generated/persisted locally | Signing key; set a long random value on shared hosts |
| `BEDROCK_MODEL_ID` | Empty | Enable optional Converse agent |
| `AWS_REGION` | `eu-central-1` | Bedrock region |
| `PUBLIC_ORIGIN` | Local request origin | Exact external HTTPS origin when hosting |

Hosting requires HTTPS, durable data, explicit origin, appropriate credentials and a single instance. Browser microphone access outside localhost requires HTTPS. Nothing is publicly deployed. Compose does not forward host AWS profiles; supply an appropriate credential mechanism to test Bedrock inside Docker.

## Verification

```sh
npm run check
npm test
npm run build
# With the app running in another terminal:
npm run smoke
```

Tests cover entry without login, password-free profile switching, an enabled recording control, blocked microphone/retry, captured PCM-to-WAV upload, cancellation with late permission, real HTTP MCP, protocol negotiation, role authorization, creation/upload/share idempotency, preserved takes, actual ffmpeg output, both offset directions, AudioWorklet block boundaries, confirmation, fixed-version gifts, expired URLs and opened/played states. Test data is generated instrumental audio in isolated temporary directories.

The browser workflow was exercised with labeled sample tones. Physical microphone capture, headphone alignment, speech recognition and AWS need environment-specific checks; synthetic tests do not establish performance on your hardware.

## Simulated or deferred

- Alexa+ presentation: no Echo connection or restricted preview SDK.
- Freely switchable demo roles: no login, household identity, or speaker identification.
- Curated guide tones: no arbitrary-song analysis, AI singer, pitch correction or automatic harmonization.
- Inbox when opening HarmonyMate: no proactive native Alexa notifications.
- Preauthorized Ben membership: no invitation delivery or external messages.
- Polly, Supabase, public hosting, real-time remote singing and automatic latency calibration are deferred.

## Material and licenses

“A little closer” is an original note-sequence exercise in `shared/music.ts`, rendered with additive sine tones. No third-party songs, samples, celebrity voices or Amazon/Alexa logos. Code/composition: MIT. Guides are instrumental tones, not synthesized human singers.

Dependencies keep their licenses: React, Vite, Express, Zod, Lucide, tsx and MCP TypeScript SDK (MIT); AWS SDK (Apache-2.0); bundled DM Sans/Manrope fonts (SIL Open Font License via Fontsource). Fonts are served locally. ffmpeg's LGPL/GPL terms depend on its build; consult that distribution before redistribution.

See [plan](docs/HARMONYMATE_PLAN.md), [official checks](OFFICIAL_SOURCE_CHECK.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [friction log](FRICTION.md).
