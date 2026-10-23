# Implementation status

Updated 2026-10-22. This file records implementation versus verification; the original planning document is not a completion checklist.

## Implemented

- React/Vite interface: direct entry without login, a lightweight demo-singer selector, singing space, studio, role-scoped recipient inbox, and real MCP tool activity.
- Node/Express backend, persistent SQLite and private local files. This is the chosen reproducible MVP storage in place of Supabase.
- Ten official-SDK MCP tools over authenticated stateless Streamable HTTP; simulator actions cross the real HTTP boundary.
- Original eight-bar lead and lower harmony guide tones; explicitly labeled sample-tone test path.
- AudioWorklet PCM capture with frame metadata, shared AudioContext playback, count-in, wired-headphone acknowledgement and manual signed offset.
- Separate takes, retake preservation, gain/mute, real waveform display and independent playback.
- Persisted asynchronous ffmpeg mix jobs and immutable snapshots.
- Actor-bound recording uploads, access-controlled short-lived audio links, per-song and per-recipient checks.
- Explicit server-recorded share confirmation, fixed mix version, recipient opening and separate playback completion.
- Scripted conversation and optional Bedrock Converse tool-use integration. Optional browser speech input/output.
- Dockerfile, compose, MIT license, environment example, English README, tests and smoke script.

## Verified

- TypeScript checking and Vite production build.
- Real MCP initialization explicitly negotiates 2025-11-25; SDK client lists ten tools and executes them.
- ffmpeg output from two independent synthetic sample tracks.
- Positive and negative offsets against known impulse sample positions.
- AudioWorklet starts at T0 across processing-block boundaries and flushes the final partial block.
- Idempotent creation/upload/share, rejected cross-account reads/writes, rejected unaccepted share, expired-link rejection, fixed-version mix preservation after retakes.
- Production-build browser workflow: Alex and Ben each save an explicitly labeled instrumental sample, ffmpeg renders their mix, Alex confirms a gift, Mom opens and plays it, and the gift changes from opened to heard only after playback finishes.
- Real browser AudioWorklet self-check captured exactly 9,600 samples at 48 kHz starting at scheduled T0, without microphone access. This verifies browser capture plumbing, not physical device latency.
- Narrow navigation and full desktop layout were checked; compact profile switching remains accessible. Screenshots are saved in `docs/screenshots/`.
- Formatting check and dependency audit passed; no known production dependency vulnerabilities were reported at the time of the check.

## Requires a human/device or external environment

- Physical microphone permission and acoustic loopback/headphone rehearsal, including the proposed 30 ms device-alignment target.
- Browser-specific speech recognition and speech output behavior.
- A successful Bedrock call with a configured model/account; AWS usage is not yet established.
- Docker build/run: local Docker daemon is unavailable.
- Public deployment, managed storage, production identity, signed contributor invitations and Alexa-native onboarding.
- Original melody rehearsal by actual singers, English video recording, Product Feedback, and Devpost submission.

## Operational boundaries

Single instance only; local storage must be persistent. Demo accounts are shared and unsuitable for private real-family recordings. No live Echo audio, automatic harmony inference, automatic hardware latency calibration, Polly or proactive native Alexa notifications. These must remain explicit in the submission.

## Recording usability fix

- Removed the login/password screen. Fresh visitors enter as Alex and can switch demo roles directly. Internal MCP credentials and per-role resource checks remain enforced.
- Reproduced the unavailable-recording symptom: Record my part was disabled until an unexplained headphone acknowledgement. That gate is removed; headphones now only control reference monitoring, which is off by default.
- Added obvious Record my voice / Record a voice entry points that reveal and scroll to the recorder.
- Microphone permission and audio activation now start during the recording click, before MCP/network awaits. Setup has cancellation and bounded waits; permission/device errors remain visible next to the recorder with retry instructions.
- Added UI regressions using simulated microphone/worklet inputs for denied access, retry, real PCM-to-WAV upload, and cancellation followed by late permission. These do not claim a physical microphone or acoustic-latency test.
