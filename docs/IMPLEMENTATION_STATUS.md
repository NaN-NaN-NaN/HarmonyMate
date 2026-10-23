# Implementation status

Updated 2026-10-23.

## Multitrack expansion

- Six generated variants: high/low diatonic thirds and sixths, and perfect fifths. Each becomes an independent named/numbered kept track. Ready stems from earlier mixes are migrated into the track inventory without rewriting audio or gifts.
- All kept original/generated/overdub tracks, including earlier versions, have individual playback/download. Multi-selection supports synchronized playback, exact-subset saved mixes and headphones overdubbing. Names, volume and signed timing can be changed per track.
- Human overdubs preserve the selected reference IDs and remain separate microphone captures. They require explicit keep/discard review and add a new track; they do not deactivate the original voice or automatically spawn another generated part. Retakes target one explicit previous voice.
- Thirteen MCP tools, including new list_tracks/play_tracks, selectable generate_harmony parameters, and recording reference/replacement fields. English/Chinese numbered track requests and descriptive harmony selection work without an LLM; missing/ambiguous references ask for clarification.
- Numerical tests verify six generated intervals/durations, stable inventory and access controls, exact-subset mixing, additive overdubs, migration, bilingual commands and rejected references. UI/engine tests verify headphones acknowledgement and actual reference scheduling while uploaded PCM contains only the simulated microphone signal. Physical acoustic bleed and device latency still require rehearsal.
 The main experience is now **free singing → draft review → generated harmony**. Earlier planning documents describe the former curated-melody prototype.

## Implemented

- One focused session card: capture, review or harmony result. No melody suggestions, guide playback or mandatory headphones for solo capture; headphones are required only when monitoring selected tracks while overdubbing.
- Up to 30 seconds of browser AudioWorklet PCM recording, three-second count-in, finish/cancel, persistent microphone errors/retry and microphone release.
- Auto-preview after upload, explicit keep/retry/discard, reversible undo/restore and resumable drafts. Upload does not replace the previous kept take. Drafts are excluded from mixing and hidden from other project members.
- Automatic background harmony generation after explicit acceptance. Stock ffmpeg, YIN-style pitch tracking, estimated major/minor key and selectable high/low thirds, perfect fifths and sixths. No external voice model/service or AI singer.
- Original-versus-harmonized playback, generation progress/failure/retry, source-bound immutable results. A stale job cannot replace the newly selected source in the UI. Source audio remains unchanged.
- Earlier recordings and projects behind a disclosure; download and optional exact-version gift confirmation after completion.
- Thirteen authenticated Streamable HTTP MCP tools. Added `review_take` and `generate_harmony`; removed `get_harmony_guide`. Explicit keep/discard/undo voice/text commands work in scripted mode. Optional Bedrock excludes review tools and never accepts sharing confirmations.
- Existing takes without reviewStatus are treated as kept for compatibility; existing gifts and files remain preserved.
- SQLite/private files, demo roles, recipient inbox, access checks, idempotency, job persistence and immutable gift snapshots remain implemented.

## Verification scope

- TypeScript and production build; regression tests for microphone denial/retry/cancellation, captured PCM upload, review/undo and generation only after keep.
- Real HTTP MCP transport and end-to-end ffmpeg workflow, draft privacy, rejected cross-actor confirmation, prevention of activating drafts through advanced mixing, idempotent generation and non-destructive retakes.
- Known synthetic C/E/G/C phrase: estimated C major, changing three/four-semitone lower harmony, output pitch within tolerance, exact output sample duration, quiet rests and original byte preservation. Silence produces an actionable error.
- UI rendering and browser behavior checked locally; microphone acoustic quality and musical quality on diverse real singing require device/user rehearsal. Synthetic measurements do not establish those results.

## Boundaries

Local harmony uses pitch-shifted recordings and can sound processed. Short monophonic unaccompanied singing works best. Key estimation is approximate. No lyrics/chord understanding, formant-preserving AI voice, accompaniment generation, arbitrary-song catalog or real-time remote singing.

No native Echo recording, Alexa account linking, voice identity or proactive Alexa notifications. The browser is the input/playback surface. Optional Bedrock needs real account validation. Docker runtime and public deployment remain environment-dependent. Demo roles are freely switchable; they are not production authentication.

## Local launch

The current workstation uses `.env` PORT=3001 because another project also binds 3000. Use the printed terminal URL. Only one HarmonyMate process should use this data directory.
