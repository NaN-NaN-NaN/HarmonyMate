# Development friction log

Only observed development events are recorded here. This is not a claim that every entry qualifies for the hackathon's optional tooling-feedback bonus.

## 2026-10-22 — Docker executable available, daemon unavailable

- **Task:** Verify the single-container local deployment.
- **Steps:** Locate Docker, then run `docker info --format '{{.ServerVersion}}'`.
- **Expected:** A reachable Docker engine and server version.
- **Actual:** Cannot connect to the daemon at the local Docker socket.
- **Severity:** Medium; container runtime verification is blocked, native development is not.
- **Workaround:** Run Node and system ffmpeg natively; provide Dockerfile/compose but mark runtime verification pending.
- **Suggestion:** Include a daemon-health preflight before initiating container build steps.

## 2026-10-22 — MCP tool registration loses inference across a schema union

- **Task:** Register the domain's tool definitions using the official TypeScript SDK.
- **Steps:** Loop over a typed map of ten distinct Zod schemas, using one asynchronous callback.
- **Expected:** A callback result with text content and structured content infers as an MCP CallToolResult.
- **Actual:** TypeScript widens the text block's `type` field to string and cannot infer a common callback argument across the input-schema union.
- **Severity:** Low; compile-time integration friction.
- **Workaround:** Explicitly type the callback input and SDK CallToolResult output. Domain-boundary Zod validation remains in place.
- **Suggestion:** Document a dynamic tool-registry example in addition to per-tool examples.

## 2026-10-22 — Fontsource variable-font import differs from assumed path

- **Task:** Bundle fonts locally to remove external font requests.
- **Steps:** Install variable font packages and import a guessed `latin.css` path.
- **Expected:** A supported subset stylesheet.
- **Actual:** Vite displayed a missing-file overlay; these packages expose an index stylesheet instead.
- **Severity:** Low; development-only interruption.
- **Workaround:** Inspect package exports and use the documented package entry. Rebuild and recheck the page.
- **Suggestion:** Resolve stylesheet paths against installed package metadata before changing CSS imports.

## 2026-10-22 — Express rejects a private dot-directory

- **Task:** Play the generated mix from Mom's browser inbox.
- **Steps:** Record two sample tones, render with ffmpeg, confirm the gift, then open it as Mom.
- **Expected:** An authorized signed URL serves the private WAV file.
- **Actual:** Express `sendFile` rejected the `.data` directory, although the integration test passed with a non-hidden temporary directory.
- **Severity:** High; the real browser flow could not play its result.
- **Workaround:** Permit dot-path serving only on the authenticated, filename-validated audio route. Change the integration fixture to use a `.data` subdirectory. Reverify actual browser playback.
- **Suggestion:** Test storage paths with the same naming and serving restrictions as production.

## Unverified external capabilities

No live Bedrock API call, physical Echo integration, or real microphone latency measurement has been performed. Do not turn the corresponding platform uncertainties into fabricated API failures or onboarding feedback.

## 2026-10-22 — Recording entry was blocked by an unexplained headphone gate

- **Task:** Start a recording from the studio.
- **Steps:** Enter the studio without checking the headphone acknowledgement; inspect Record my part.
- **Expected:** A usable recording entry that requests microphone permission.
- **Actual:** The button was disabled. Checking the headphone acknowledgement enabled it, confirming a UI gate before any recording attempt.
- **Severity:** High; users could reasonably conclude recording did not exist or was broken.
- **Fix:** Remove the gate; make reference monitoring optional, add obvious recording entry points, scroll to the recorder, start microphone activation before network awaits, and show cancellable permission setup and persistent error/retry guidance.
- **Verification:** Original browser enabled-state check changed from failing to passing. Regression tests cover no-login entry, profile selection, denied permission/retry, a simulated microphone-to-WAV upload, and cancellation followed by late permission. Physical microphone quality is not inferred from these tests.
