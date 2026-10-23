# HarmonyMate — submission materials

## Project name
HarmonyMate

## Elevator pitch
Sing a phrase. Create harmonies, add your own voice, and mix a musical gift. A conversational singing studio powered by real MCP, with a simulated Alexa+ experience.

## Project story

### Inspiration
A family song should begin with “let’s sing,” not with learning a recording workstation. We wanted to help people turn a small, familiar phrase into something they could make together and give to someone they love. HarmonyMate explores how a conversational assistant could guide that creative moment, while keeping each person in control of their recordings.

### What it does
Sing an unaccompanied phrase for up to 30 seconds. Listen to the preview, then explicitly keep it, sing again, or discard it. A pending recording never replaces a kept version, and discarded drafts can be restored.

After a recording is kept, HarmonyMate can create a lower harmony. You can also choose higher or lower thirds, perfect fifths, and sixths. Every generated part becomes an independent, numbered track. Listen to any track alone, select up to eight to hear together, rename parts, adjust volume and timing, or save an exact combination as a mix.

To add a real human harmony, select the tracks you want to hear, put on headphones, and record while they play. The microphone is captured separately from reference playback. Review and keep this new voice as its own track.

The conversational interface supports requests such as “what tracks do I have?”, “play tracks 1 and 3,” “sing with track 1,” and “make high sixth harmony from track 1.” Numbered requests and common Chinese equivalents work in the scripted simulator. Optional browser speech input and spoken responses complement the buttons and text input.

Finally, save a particular mix as a musical gift. The sender reviews its recipient, note, and fixed version before confirming. The recipient can open and play it in a separate demo inbox; later retakes do not change an already shared gift.

### How we built it
The frontend uses React, TypeScript, Vite, Web Audio and an AudioWorklet. One AudioContext schedules reference playback and microphone capture against the same start time. A three-second count-in helps the singer begin.

An Express backend stores state in SQLite and audio in a private local directory. Thirteen tools use the official MCP TypeScript SDK over authenticated Streamable HTTP, negotiating protocol 2025-11-25. Even scripted conversational actions cross the real HTTP MCP client/server boundary. Tools cover track inventory and playback selection, recording preparation, explicit take review, harmony jobs, immutable mixes, and musical gifts.

Harmony generation is local digital signal processing. A YIN-style pitch detector estimates the sung notes and a major/minor key. Thirds and sixths follow that estimated scale; fifths use seven semitones. Stock ffmpeg transposes the recorded voice and restores its duration, then blends and mixes the generated part. Jobs are persisted and return immediately so processing can finish in the background. Generated audio has its own file, source reference, name and stable track number.

### Challenges we ran into
The first version asked users to learn a prescribed melody and understand several studio controls at once. We replaced that with free singing and one clear decision after recording: keep, retry, or discard. We also removed a headphone gate from solo recording; headphones are required only when reference tracks actually play during overdubbing.

Audio timing, microphone permission cancellation, and non-destructive versioning required careful boundaries. Tests exercise late permission grants, AudioWorklet sample scheduling, draft privacy, exact track subsets, and preserving old mixes after retakes. We also fixed an Express file-serving issue involving the private .data directory.

### Accomplishments and what we learned
The result is a working path from singing to independent harmonies, a human overdub, a saved mix and a confirmed gift, with real MCP calls visible in an activity view. Eight automated tests pass, including numerical checks for all six harmony variants, unchanged source audio, output duration, authorization, bilingual track commands, and simulated microphone-only overdub uploads. Production builds and a live MCP smoke test pass.

The main UX lesson was that accepting a recording is a meaningful user decision. Automatic upload should not imply approval, replacement, or sharing. Another lesson was to give conversational references a stable identity: track numbers make voice and text selection much less ambiguous than “the last one.”

### What is real, simulated, and next
The recording pipeline, MCP transport, persistence, track selection, local harmony processing, mixing and confirmation checks are implemented. Alexa+ is simulated in the browser; this project does not connect to an Echo microphone, provide native Alexa notifications or implement production Alexa account linking. Demo profiles are freely switchable and intended for test material.

The harmony is pitch-shifted recorded voice, not a generative AI singer. It can sound processed, and short, clean, unaccompanied phrases work best. Key estimation is approximate. Synthetic tests verify the pipeline and musical intervals; microphone acoustics, singing quality and physical device latency still need device rehearsal. Optional Bedrock Converse integration is included but has not been validated with a live AWS account and is not claimed as demonstrated AWS runtime usage.

Next steps are listening tests with actual singers, better timbre preservation and key correction, production identity/invitations, and official Alexa+ onboarding when access is available.

## Built with
TypeScript; React; Vite; Node.js; Express; SQLite; Model Context Protocol; Web Audio API; AudioWorklet; ffmpeg; Zod

## Repository / testing instructions
https://github.com/NaN-NaN-NaN/HarmonyMate

Requires Node.js >=22.13, npm, ffmpeg and ffprobe. Run npm ci, copy .env.example to .env, then npm run dev and open the printed localhost URL. No AWS account is required for the scripted simulator and local harmony processing. The README includes full steps and limitations. npm test, npm run build and npm run smoke verify the main pipeline.

## Track
Alexa+ — self-hosted MCP server with a clearly labeled simulated Alexa+ browser experience.

## Product feedback

**MCP TypeScript SDK and Zod.** We used the official SDK to register and invoke thirteen tools over Streamable HTTP, with Zod validation at both transport and domain boundaries. The actual client/server split made the simulation credible and testable. Dynamic registration of a union of schemas required explicit callback/result types; a documented dynamic-registry example would help onboarding. We would use the SDK again.

**Web Audio API / AudioWorklet and browser media APIs.** These provide real PCM capture, level monitoring, count-in and reference scheduling in one AudioContext. Permission denial and late permission grants required visible retry/cancel paths and reliable microphone cleanup. Browser/device behavior and physical latency need separate rehearsal; synthetic capture tests are not hardware measurements. We would use these APIs again, with device-focused onboarding and calibration.

**ffmpeg / ffprobe.** We use them to validate and normalize uploads, transpose voices and render real mixes. They work locally without cloud credentials and make output inspectable. Stock resampling/tempo processing changes timbre and can smear consonants; formant-preserving processing is a future improvement. Clear preflight checks and platform-specific installation guidance help reproducibility. We would use ffmpeg again.

**React / TypeScript / Vite, Express and SQLite.** These support a small, reproducible single-instance demo with local fonts, an interactive studio, private file routes and persistent jobs. A real browser test exposed Express rejecting a dot-directory even though the first temporary-directory test passed. Matching test paths to real deployment paths fixed the discrepancy. We would use this stack again; multi-instance deployment would need different job claiming/storage design.

**Alexa+ developer ecosystem.** We used the published MCP requirements and the hackathon's simulated-experience route. We did not have access to the restricted Alexa+ toolkit/CLI/web simulator or an Echo recording API for this project, so we built our own browser simulator. The distinction between publicly readable onboarding documentation and restricted tool access should be clearer. We would explore official onboarding when available, with explicit account linking and a supported recording handoff.

**Optional Amazon Bedrock Converse.** Code maps the same MCP schemas to tool use with bounded calls and explicit degraded behavior. No live AWS model/account was configured, so we cannot give a verified runtime-performance/onboarding assessment or claim this as a working AWS Builder integration.

## Friction log
See FRICTION.md for observed tasks, expected versus actual outcomes, workarounds and suggestions. No external API failures or hardware tests are fabricated.

## Video materials
A 2:08, 1920×1080 English screenshot walkthrough with synthetic narration and burned-in captions is included at docs/video/HarmonyMate-walkthrough.mp4, alongside an English SRT file and its reproducible build script. This introduces the implemented browser flow, independent tracks, overdubbing, gifts and the real MCP boundary. It clearly labels Alexa+ as simulated. No actual singing or generated harmony is audible in this presentation.

A publicly viewable YouTube/Vimeo link is still needed for the Devpost video field. For a stronger product demonstration, supplement the introduction with a live recording: sing a short original phrase; preview and keep; add high sixth / low third; query the track list; play a selected pair; add a human harmony with headphones; keep the new track; save a mix and confirm a gift; show the MCP activity view.
