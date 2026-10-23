import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CircleHelp,
  Code2,
  Gift,
  Loader2,
  Mic,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  PEOPLE,
  DEFAULT_HARMONY,
  harmonyLabel,
  type HarmonyOptions,
  type Actor,
  type AgentResponse,
  type Bootstrap,
  type Confirmation,
  type SongView,
} from "../shared/types.ts";
import { api, post, tool } from "./api.ts";
import { audio, type AudioState } from "./audio/engine.ts";
import { Avatar, Brand, Waveform } from "./components.tsx";
import { recognitionConstructor, say, type RecognitionLike } from "./speech.ts";

import TrackStudio from "./TrackStudio.tsx";

type Page = "studio" | "inbox" | "activity";
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("studio");
  const [selectedSong, setSelectedSong] = useState("");
  const [sound, setSound] = useState<AudioState>(audio.state);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [recordingError, setRecordingError] = useState("");
  const [notice, setNotice] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [recordRefs, setRecordRefs] = useState<string[]>([]);
  const [overdubbing, setOverdubbing] = useState(false);
  const [headphonesReady, setHeadphonesReady] = useState(false);
  const [giftMixId, setGiftMixId] = useState("");
  const selectionContext = useRef({ key: "", known: new Set<string>() });
  const [undoId, setUndoId] = useState("");
  const [playing, setPlaying] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState(
    "A little song, from me to you.",
  );
  const [command, setCommand] = useState("");
  const [reply, setReply] = useState("");
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState(
    navigator.language?.startsWith("zh") ? "zh-TW" : "en-US",
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const card = useRef<HTMLElement>(null);
  const song = data?.songs.find((s) => s.id === selectedSong) ?? data?.songs[0];
  const mine = song?.takes.filter((take) => take.actor === data?.actor) ?? [];
  const draft = mine.findLast((take) => take.reviewStatus === "draft");
  const kept = mine.findLast(
    (take) =>
      take.source !== "generated-harmony" &&
      take.active &&
      (take.reviewStatus ?? "kept") === "kept",
  );
  const harmony = song?.mixes.findLast(
    (mix) => mix.kind === "harmony" && mix.sourceTakeId === kept?.id,
  );
  const generating =
    harmony?.status === "queued" || harmony?.status === "running";
  const pendingJobs = song?.mixes.some(
    (mix) => mix.status === "queued" || mix.status === "running",
  );
  const giftMix = song?.mixes.find((mix) => mix.id === giftMixId) ?? harmony;
  const giftReady = giftMix?.status === "ready";
  const ready = harmony?.status === "ready" && !!harmony.url;
  const captureBusy =
    ["requesting", "loading", "countdown", "recording"].includes(sound.mode) &&
    busy === "Recording";
  const isRecording = sound.mode === "recording" || sound.mode === "countdown";
  const showReview = !!draft && !retrying;
  const showCapture = !showReview && (!kept || retrying || captureBusy);
  const locked = !!busy || isRecording;

  const refresh = useCallback(async () => {
    const next = await api<Bootstrap>("/api/bootstrap");
    setData(next);
    setSelectedSong((old) =>
      next.songs.some((s) => s.id === old) ? old : (next.songs[0]?.id ?? ""),
    );
    return next;
  }, []);
  useEffect(() => {
    audio.onChange = setSound;
    void refresh()
      .then((next) => {
        if (next.actor === "mom") setPage("inbox");
      })
      .catch((error) => setLoadError(error.message));
    return () => {
      audio.stop();
      audio.onChange = () => {};
      recognition.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const interval = setInterval(
      () => {
        if (!document.hidden && !busyRef.current)
          void refresh().catch(() => {});
      },
      pendingJobs ? 900 : 10000,
    );
    return () => clearInterval(interval);
  }, [!!data, pendingJobs, refresh]);
  useEffect(() => {
    if (!song || !data) return;
    const key = `${song.id}:${data.actor}`;
    const tracks = song.takes.filter(
      (t) => (t.reviewStatus ?? "kept") === "kept",
    );
    if (selectionContext.current.key !== key) {
      setSelectedTracks(
        tracks
          .filter((t) => t.active)
          .slice(0, 8)
          .map((t) => t.id),
      );
    } else {
      const added = tracks.filter(
        (t) => !selectionContext.current.known.has(t.id) && t.active,
      );
      if (added.length)
        setSelectedTracks((ids) =>
          [...ids, ...added.map((t) => t.id)].slice(0, 8),
        );
    }
    selectionContext.current = { key, known: new Set(tracks.map((t) => t.id)) };
  }, [song, data?.actor]);
  useEffect(() => {
    if (!confirmation && !showHelp) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea, input, a[href]",
        ) ?? [],
      );
    elements()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        setConfirmation(null);
        setShowHelp(false);
      }
      const items = elements();
      if (event.key === "Tab" && items.length) {
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [!!confirmation, showHelp]);
  function silence() {
    recognition.current?.abort();
    setListening(false);
    window.speechSynthesis?.cancel();
  }
  function speak(text: string) {
    setReply(text);
    if (voiceOutput && audio.state.mode === "idle") say(text);
  }
  async function task(label: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setNotice("");
    try {
      await fn();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Please try again.");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }
  async function play(url: string, label: string, onEnded?: () => void) {
    silence();
    setPlaying(label);
    try {
      await audio.playUrl(url, () => {
        setPlaying("");
        onEnded?.();
      });
    } catch (error) {
      setPlaying("");
      setNotice(
        error instanceof Error ? error.message : "Playback failed. Try again.",
      );
    }
  }
  function stopPlayback() {
    audio.stop();
    setPlaying("");
  }
  function showRecorder(references: string[] = [], asOverdub = false) {
    setRecordRefs(references);
    setOverdubbing(asOverdub);
    setHeadphonesReady(false);
    silence();
    stopPlayback();
    setRetrying(true);
    setShowGift(false);
    setRecordingError("");
    setPage("studio");
    requestAnimationFrame(() =>
      card.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }
  async function record() {
    if (!song || (overdubbing && !headphonesReady)) return;
    await task("Recording", async () => {
      silence();
      stopPlayback();
      setRecordingError("");
      setRetrying(true);
      setUndoId("");
      try {
        // Permission must begin synchronously in the click, before network calls.
        const references = recordRefs
          .map((id) => song.takes.find((t) => t.id === id))
          .filter(
            (t): t is SongView["takes"][number] =>
              !!t && (t.reviewStatus ?? "kept") === "kept",
          );
        if (
          overdubbing &&
          (!references.length || references.length !== recordRefs.length)
        )
          throw new Error("Choose available tracks before singing along.");
        const captured = audio.record(
          references.map((t) => ({ ...t, active: true, muted: false })),
        );
        const session = tool("start_recording_session", {
          songId: song.id,
          part: overdubbing ? "harmony" : (draft?.part ?? kept?.part ?? "lead"),
          ...(!overdubbing && (draft?.replacesTakeId ?? kept?.id)
            ? { replacesTakeId: draft?.replacesTakeId ?? kept?.id }
            : {}),
          ...(overdubbing
            ? { referenceTakeIds: recordRefs, addTrack: true }
            : draft?.referenceTakeIds?.length
              ? { referenceTakeIds: draft.referenceTakeIds, addTrack: true }
              : {}),
        });
        const [result, recordingSession] = await Promise.all([
          captured,
          session,
        ]);
        setBusy("Preparing your preview");
        const upload = await api<{ takeId: string }>(
          `/api/recordings/${recordingSession.sessionId}/audio`,
          {
            method: "POST",
            body: new Blob([new Uint8Array(result.wav)], { type: "audio/wav" }),
            headers: {
              "Content-Type": "audio/wav",
              "X-Capture": JSON.stringify(result.capture),
            },
          },
        );
        const next = await refresh();
        setRetrying(false);
        const take = next.songs
          .flatMap((s) => s.takes)
          .find((t) => t.id === upload.takeId);
        setReply("Recorded. Keep this take, or sing again.");
        if (take) await play(take.url, "Your new recording");
      } catch (error) {
        audio.stop();
        const message =
          error instanceof Error
            ? error.message
            : "Recording could not finish. Please try again.";
        if (!/cancelled/i.test(message)) setRecordingError(message);
      }
    });
  }
  async function generate(
    takeId: string,
    options: HarmonyOptions = DEFAULT_HARMONY,
  ) {
    if (!song) return;
    await tool("generate_harmony", { songId: song.id, takeId, ...options });
    await refresh();
  }
  async function review(
    decision: "keep" | "discard" | "restore",
    takeId = draft?.id,
  ) {
    if (!song || !takeId) return;
    await task(
      decision === "keep"
        ? "Keeping your recording"
        : "Updating your recording",
      async () => {
        silence();
        stopPlayback();
        await tool("review_take", { songId: song.id, takeId, decision });
        setRetrying(false);
        setShowGift(false);
        if (decision === "discard") {
          setUndoId(takeId);
          speak("Discarded. Your last kept version is safe.");
        } else {
          setUndoId("");
          speak(
            decision === "keep"
              ? song.takes.find((t) => t.id === takeId)?.referenceTakeIds
                  ?.length
                ? "Kept as a new voice track."
                : "Kept. Making your harmony."
              : "Restored for review.",
          );
        }
        await refresh();
        if (decision === "keep") {
          const take = song.takes.find((t) => t.id === takeId);
          if (take?.replacesTakeId)
            setSelectedTracks((ids) =>
              ids.filter(
                (id) =>
                  id !== take.replacesTakeId &&
                  song.takes.find((t) => t.id === id)?.parentTakeId !==
                    take.replacesTakeId,
              ),
            );
          if (!take?.referenceTakeIds?.length) await generate(takeId);
          else
            speak(
              "Kept as a new voice track. Your other tracks are unchanged.",
            );
        }
      },
    );
  }
  async function createSong() {
    await task("Creating a song", async () => {
      silence();
      stopPlayback();
      const result = await tool("create_song", {
        title: "Untitled song",
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setSelectedSong((result.song as SongView).id);
      setRetrying(false);
      setUndoId("");
      setShowGift(false);
      setRecordingError("");
      setReply("");
      setPage("studio");
    });
  }
  async function switchProfile(actor: Actor) {
    await task("Changing singer", async () => {
      silence();
      stopPlayback();
      await post("/api/demo/profile", { actor });
      await refresh();
      setRetrying(false);
      setUndoId("");
      setShowGift(false);
      setConfirmation(null);
      setRecordingError("");
      setReply("");
      setPage(actor === "mom" ? "inbox" : "studio");
    });
  }
  async function prepareGift() {
    if (!song || !giftMix || !giftReady || draft) return;
    await task("Preparing your gift", async () => {
      const result = await tool("create_surprise", {
        songId: song.id,
        mixId: giftMix.id,
        recipient: "mom",
        message: giftMessage,
      });
      setConfirmation(
        await api<Confirmation>(`/api/confirmations/${result.confirmationId}`),
      );
    });
  }
  async function playSelected(ids: string[]) {
    if (!song) return;
    silence();
    stopPlayback();
    const result = await tool("play_tracks", { songId: song.id, takeIds: ids });
    const tracks = result.tracks as SongView["takes"];
    setPlaying(`Tracks ${tracks.map((t) => `#${t.trackNumber}`).join(" + ")}`);
    await audio.playTracks(
      tracks.map((t) => ({ ...t, active: true, muted: false })),
      () => setPlaying(""),
    );
  }
  async function reveal(surpriseId: string) {
    await task("Opening your gift", async () => {
      const result = await tool("reveal_surprise", { surpriseId });
      await refresh();
      await play(String(result.url), "Your musical gift", () => {
        void post(`/api/surprises/${surpriseId}/played`)
          .then(refresh)
          .catch(() => {});
      });
    });
  }
  async function sendCommand(text = command) {
    if (!text.trim() || locked) return;
    setCommand("");
    if (
      /^(sing again|record again|重唱|再唱一次)[.!。！]?$/i.test(text.trim())
    ) {
      showRecorder();
      return;
    }
    if (/^(stop|停止)[.!。！]?$/i.test(text.trim())) {
      stopPlayback();
      return;
    }
    if (/^(listen again|再聽一次)[.!。！]?$/i.test(text.trim()) && draft) {
      await play(draft.url, "Your new recording");
      return;
    }
    await task("Working on your request", async () => {
      silence();
      stopPlayback();
      const response = await post<AgentResponse>("/api/agent", {
        text,
        songId: song?.id,
        selectedTakeIds: selectedTracks,
      });
      await refresh();
      speak(response.text);
      const action = response.action;
      if (action?.type === "record") {
        if (action.referenceTakeIds?.length)
          setSelectedTracks(action.referenceTakeIds);
        showRecorder(
          action.referenceTakeIds ?? [],
          !!action.referenceTakeIds?.length,
        );
      }
      if (action?.type === "play_tracks") {
        setSelectedTracks(action.takeIds);
        setPage("studio");
        await playSelected(action.takeIds);
      }
      if (action?.type === "review") {
        setRetrying(false);
        setPage("studio");
        const next = await refresh();
        const take = next.songs
          .flatMap((s) => s.takes)
          .find((t) => t.id === action.takeId);
        if (take && /listen|play|聽|播放/i.test(text))
          await play(take.url, "Your new recording");
      }
      if (action?.type === "song") {
        setSelectedSong(action.songId);
        setRetrying(false);
        setPage("studio");
      }
      if (action?.type === "mix") {
        setRetrying(false);
        setPage("studio");
      }
      if (action?.type === "share")
        setConfirmation(
          await api<Confirmation>(
            `/api/confirmations/${action.confirmationId}`,
          ),
        );
      if (action?.type === "reveal")
        await play(action.url, "Your musical gift", () => {
          void post(`/api/surprises/${action.surpriseId}/played`)
            .then(refresh)
            .catch(() => {});
        });
    });
  }
  function voiceCommand() {
    if (locked) return;
    if (listening) {
      recognition.current?.abort();
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setNotice(
        "Voice commands aren’t available here. Use the buttons or type below.",
      );
      return;
    }
    silence();
    stopPlayback();
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = voiceLanguage;
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) void sendCommand(text);
    };
    instance.onerror = (event) => {
      if (event.error !== "aborted")
        setNotice(`Voice input: ${event.error}. You can use text or buttons.`);
    };
    instance.onend = () => setListening(false);
    setListening(true);
    instance.start();
  }

  if (!data)
    return (
      <div className="initial-loading">
        <Brand />
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            <span>Opening your singing space…</span>
          </>
        )}
      </div>
    );
  const person = PEOPLE.find((p) => p.id === data.actor)!;
  const stage = showReview ? 1 : showCapture ? 0 : 2;

  return (
    <div className="simple-app">
      <header className="simple-header">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            aria-current={page === "studio" ? "page" : undefined}
            onClick={() => !locked && setPage("studio")}
          >
            <AudioLines size={17} />
            The studio
          </button>
          <button
            aria-current={page === "inbox" ? "page" : undefined}
            onClick={() => !locked && setPage("inbox")}
          >
            <Gift size={17} />
            Surprise inbox
            {data.surprises.some((s) => !s.openedAt) && (
              <span className="simple-dot" />
            )}
          </button>
        </nav>
        <div className="simple-profile">
          <Avatar actor={data.actor} size="small" />
          <label>
            <span>Demo singer</span>
            <select
              aria-label="Demo singer"
              value={data.actor}
              disabled={locked}
              onChange={(e) => void switchProfile(e.target.value as Actor)}
            >
              {PEOPLE.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="simple-main">
        {page === "studio" && (
          <>
            <div className="simple-intro">
              <span className="eyebrow">
                YOUR VOICE. A LITTLE MORE TOGETHER.
              </span>
              <h1>
                Sing a little.
                <br />
                <em>Hear the harmony.</em>
              </h1>
              <p>A song you know. A phrase you love. Start with your voice.</p>
            </div>
            {song ? (
              <>
                <div className="simple-journey" aria-label="Your progress">
                  {["Sing", "Review", "Harmony"].map((label, i) => (
                    <div
                      key={label}
                      aria-current={stage === i ? "step" : undefined}
                      className={i < stage ? "complete" : ""}
                    >
                      <span>{i < stage ? <Check size={13} /> : i + 1}</span>
                      {label}
                    </div>
                  ))}
                </div>
                <section
                  className="simple-session"
                  ref={card}
                  aria-labelledby="session-heading"
                >
                  <div className="simple-session-top">
                    <span className="mini-eyebrow">
                      {song.title === "A little closer"
                        ? "YOUR RECORDING"
                        : song.title.toUpperCase()}
                    </span>
                    <span>
                      <ShieldCheck size={13} />
                      Only shared when you choose
                    </span>
                  </div>
                  {showCapture ? (
                    <div className="simple-capture">
                      <div
                        className={`simple-orb ${isRecording ? "live" : ""}`}
                        style={
                          { "--level": sound.level } as React.CSSProperties
                        }
                      >
                        {sound.mode === "countdown" ? (
                          <strong>{sound.countdown || 3}</strong>
                        ) : captureBusy ? (
                          <AudioLines size={38} />
                        ) : (
                          <Mic size={38} strokeWidth={1.4} />
                        )}
                      </div>
                      <span className="mini-eyebrow">
                        {isRecording ? "YOUR MOMENT" : "NO MELODY TO LEARN"}
                      </span>
                      <h2 id="session-heading">
                        {sound.mode === "countdown"
                          ? "Ready, set…"
                          : sound.mode === "recording"
                            ? "Go on. It’s all you."
                            : captureBusy
                              ? "Getting your microphone ready…"
                              : busy === "Preparing your preview"
                                ? "Preparing your preview…"
                                : "What do you feel like singing?"}
                      </h2>
                      <p>
                        {overdubbing
                          ? `Sing a new harmony while tracks ${recordRefs.map((id) => `#${song.takes.find((t) => t.id === id)?.trackNumber ?? "?"}`).join(", ")} play in your headphones.`
                          : "Sing a short phrase you know, without background music."}
                        <br />
                        {overdubbing
                          ? "Only your microphone is saved as a new track."
                          : "We’ll make a lower harmony from your recording."}
                      </p>
                      {overdubbing && (
                        <label className="overdub-headphones">
                          <input
                            type="checkbox"
                            checked={headphonesReady}
                            disabled={locked}
                            onChange={(e) =>
                              setHeadphonesReady(e.target.checked)
                            }
                          />
                          I’m wearing headphones
                        </label>
                      )}
                      {isRecording && (
                        <div className="simple-record-progress">
                          <span>{time(sound.seconds)} / 0:30</span>
                          <progress
                            value={sound.progress}
                            max="1"
                            aria-label="Recording progress"
                          />
                        </div>
                      )}
                      {isRecording ? (
                        <button
                          className="button primary"
                          onClick={() =>
                            sound.mode === "countdown"
                              ? audio.stop()
                              : audio.finishRecording()
                          }
                        >
                          <Square size={16} />
                          {sound.mode === "countdown"
                            ? "Cancel count-in"
                            : "Finish take"}
                        </button>
                      ) : captureBusy ? (
                        <button
                          className="button secondary"
                          onClick={() => audio.stop()}
                        >
                          Cancel microphone setup
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          disabled={locked || (overdubbing && !headphonesReady)}
                          onClick={() => void record()}
                        >
                          {busy ? (
                            <Loader2 size={17} className="spin" />
                          ) : (
                            <Mic size={17} />
                          )}
                          Record my part
                        </button>
                      )}
                      <span className="simple-caption">
                        3-second count-in · Up to 30 seconds ·{" "}
                        {overdubbing
                          ? "Headphones required for playback"
                          : "No headphones needed"}
                      </span>
                      {retrying && (draft || kept) && !locked && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setRetrying(false);
                            setRecordingError("");
                          }}
                        >
                          Back to my {draft ? "preview" : "kept recording"}
                        </button>
                      )}
                      {recordingError && (
                        <div className="recording-error" role="alert">
                          <strong>Let’s try that again</strong>
                          <p>{recordingError}</p>
                        </div>
                      )}
                    </div>
                  ) : showReview && draft ? (
                    <div className="simple-review">
                      <span className="simple-status">
                        <span className="simple-dot" />
                        WAITING FOR YOUR CHOICE
                      </span>
                      <h2 id="session-heading">Keep this little moment?</h2>
                      <p>
                        Listen once. Keep it, or give it another go.
                        <br />
                        This recording hasn’t replaced your kept version.
                      </p>
                      <div className="simple-wave">
                        <Waveform
                          url={draft.url}
                          progress={
                            playing === "Your new recording"
                              ? sound.progress
                              : 0
                          }
                        />
                        <span>{time(draft.duration)}</span>
                      </div>
                      <span className="simple-source">
                        {draft.source === "sample-tone"
                          ? "INSTRUMENTAL TEST SAMPLE"
                          : "HUMAN RECORDING"}{" "}
                        · PREVIEW
                      </span>
                      <button
                        className="simple-listen"
                        disabled={locked}
                        onClick={() =>
                          sound.mode === "playing"
                            ? stopPlayback()
                            : void play(draft.url, "Your new recording")
                        }
                      >
                        {sound.mode === "playing" ? (
                          <Square size={15} />
                        ) : (
                          <Play size={15} />
                        )}
                        {sound.mode === "playing"
                          ? "Stop preview"
                          : "Listen again"}
                      </button>
                      <div className="simple-actions">
                        <button
                          className="button primary"
                          disabled={locked}
                          onClick={() => void review("keep")}
                        >
                          <Check size={17} />
                          Keep this take
                        </button>
                        <button
                          className="button secondary"
                          disabled={locked}
                          onClick={() =>
                            showRecorder(
                              draft?.referenceTakeIds ?? [],
                              !!draft?.referenceTakeIds?.length,
                            )
                          }
                        >
                          <RotateCcw size={16} />
                          Sing again
                        </button>
                      </div>
                      <button
                        className="simple-discard"
                        disabled={locked}
                        onClick={() => void review("discard")}
                      >
                        <Trash2 size={14} />
                        Discard this take
                      </button>
                      <span className="simple-caption">
                        Harmony starts after you keep this recording.
                      </span>
                    </div>
                  ) : (
                    <div className="simple-result">
                      <span className="simple-status">
                        <Check size={14} />
                        YOUR RECORDING IS KEPT
                      </span>
                      <div
                        className={`simple-orb result ${generating ? "working" : ""}`}
                      >
                        {generating ? (
                          <Loader2 size={36} className="spin" />
                        ) : (
                          <Sparkles size={36} strokeWidth={1.4} />
                        )}
                      </div>
                      <h2 id="session-heading">
                        {generating
                          ? "Finding your other voice…"
                          : ready
                            ? "You, with a little harmony."
                            : harmony?.status === "failed"
                              ? "Your voice is safe."
                              : "Let’s add a little harmony."}
                      </h2>
                      <p>
                        {generating
                          ? `Making ${harmonyLabel(harmony?.harmonyOptions).toLowerCase()} from the notes you sang. You can leave and come back.`
                          : ready
                            ? kept?.source === "sample-tone"
                              ? `An instrumental test sample, with ${harmonyLabel(harmony?.harmonyOptions).toLowerCase()}.`
                              : `Your original voice, alongside ${harmonyLabel(harmony?.harmonyOptions).toLowerCase()}.`
                            : harmony?.error ||
                              "Your recording is ready. Make a lower harmony whenever you like."}
                      </p>
                      {ready ? (
                        <>
                          <div className="simple-wave">
                            <Waveform
                              url={harmony.url}
                              color="#7c8268"
                              progress={
                                playing === "With harmony" ? sound.progress : 0
                              }
                            />
                            <span>{time(kept?.duration ?? 0)}</span>
                          </div>
                          <div className="simple-actions">
                            <button
                              className="button primary"
                              disabled={locked}
                              onClick={() =>
                                playing === "With harmony" &&
                                sound.mode === "playing"
                                  ? stopPlayback()
                                  : void play(harmony.url!, "With harmony")
                              }
                            >
                              {playing === "With harmony" &&
                              sound.mode === "playing" ? (
                                <Square size={17} />
                              ) : (
                                <Play size={17} />
                              )}
                              {playing === "With harmony" &&
                              sound.mode === "playing"
                                ? "Stop harmony"
                                : "Listen with harmony"}
                            </button>
                            <button
                              className="button secondary"
                              disabled={locked}
                              onClick={() =>
                                kept && void play(kept.url, "Original voice")
                              }
                            >
                              <Mic size={16} />
                              Original only
                            </button>
                          </div>
                          <span className="simple-source">
                            {kept?.source === "sample-tone"
                              ? "INSTRUMENTAL TEST SAMPLE · GENERATED HARMONY"
                              : "GENERATED HARMONY · LOCAL VOICE PROCESSING"}
                          </span>
                        </>
                      ) : (
                        !generating &&
                        kept && (
                          <button
                            className="button primary"
                            disabled={locked}
                            onClick={() =>
                              void task("Making harmony", () =>
                                generate(kept.id),
                              )
                            }
                          >
                            <Sparkles size={17} />
                            {harmony?.status === "failed"
                              ? "Try harmony again"
                              : "Make my harmony"}
                          </button>
                        )
                      )}
                      <button
                        className="simple-listen"
                        disabled={locked}
                        onClick={() =>
                          showRecorder(
                            draft?.referenceTakeIds ?? [],
                            !!draft?.referenceTakeIds?.length,
                          )
                        }
                      >
                        <RotateCcw size={15} />
                        Sing another take
                      </button>
                      <span className="simple-caption">
                        {ready
                          ? "Estimated key: " +
                            harmony.estimatedKey +
                            ". Short, unaccompanied phrases work best."
                          : "Your original recording stays unchanged."}
                      </span>
                    </div>
                  )}
                  {undoId && (
                    <div className="simple-undo" role="status">
                      Recording discarded.
                      <button
                        onClick={() => void review("restore", undoId)}
                        disabled={locked}
                      >
                        Undo
                      </button>
                    </div>
                  )}
                </section>
                {!showCapture && !showReview && ready && (
                  <section className="simple-after">
                    <span>
                      <Check size={16} />
                      Saved in your singing space. You’re all set.
                    </span>
                    <div>
                      <a
                        className="text-link"
                        href={harmony.url}
                        download="my-harmony.wav"
                      >
                        <ArrowDownToLine size={15} />
                        Download
                      </a>
                      {song.owner === data.actor && (
                        <button
                          className="text-link"
                          onClick={() => {
                            setGiftMixId(harmony?.id ?? "");
                            setShowGift((v) => !v);
                          }}
                        >
                          <Gift size={16} />
                          Make a gift
                        </button>
                      )}
                    </div>
                  </section>
                )}
                {showGift && giftReady && !draft && (
                  <section className="simple-gift">
                    <h3>A little song for Mom.</h3>
                    <label htmlFor="gift-message">Add a note</label>
                    <textarea
                      id="gift-message"
                      value={giftMessage}
                      maxLength={240}
                      onChange={(e) => setGiftMessage(e.target.value)}
                    />
                    <button
                      className="button primary"
                      disabled={locked}
                      onClick={() => void prepareGift()}
                    >
                      Review gift
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setShowGift(false)}
                    >
                      Keep it here for now
                    </button>
                  </section>
                )}
                <TrackStudio
                  song={song}
                  actor={data.actor}
                  locked={locked}
                  selected={selectedTracks}
                  onSelect={setSelectedTracks}
                  onPlay={(ids) =>
                    void task("Playing tracks", () => playSelected(ids))
                  }
                  onOverdub={(ids) => {
                    setSelectedTracks(ids);
                    showRecorder(ids, true);
                  }}
                  onGenerate={(takeId, options) =>
                    void task("Making harmony", () => generate(takeId, options))
                  }
                  onUpdate={(takeId, values) =>
                    void task("Updating track", async () => {
                      await tool("set_track_mix", {
                        songId: song.id,
                        takeId,
                        ...values,
                      });
                      await refresh();
                    })
                  }
                  onSaveMix={(ids) =>
                    void task("Saving selected mix", async () => {
                      await tool("create_mix", {
                        songId: song.id,
                        takeIds: ids,
                      });
                      await refresh();
                    })
                  }
                  onPlayMix={(url) => void play(url, "Saved mix")}
                  onGift={(id) => {
                    setGiftMixId(id);
                    setShowGift(true);
                  }}
                />
                <details className="simple-details">
                  <summary>Your songs & earlier recordings</summary>
                  <div className="simple-library">
                    {data.songs.map((s) => (
                      <button
                        key={s.id}
                        disabled={locked}
                        aria-pressed={s.id === song.id}
                        onClick={() => {
                          silence();
                          stopPlayback();
                          setSelectedSong(s.id);
                          setRetrying(false);
                          setShowGift(false);
                          setUndoId("");
                          setRecordingError("");
                        }}
                      >
                        {s.title}
                        <span>
                          {
                            s.takes.filter(
                              (t) => (t.reviewStatus ?? "kept") === "kept",
                            ).length
                          }{" "}
                          kept takes
                        </span>
                      </button>
                    ))}
                    <button onClick={() => void createSong()} disabled={locked}>
                      <Plus size={15} />
                      New song
                    </button>
                  </div>
                  {mine.length > 0 && (
                    <div className="simple-history">
                      {[...mine].reverse().map((take) => (
                        <div key={take.id}>
                          <span>
                            {take.source === "sample-tone"
                              ? "Test sample"
                              : "Your recording"}
                            <small>
                              {time(take.duration)} ·{" "}
                              {take.reviewStatus ?? "kept"}
                              {take.active ? " · current" : ""}
                            </small>
                          </span>
                          <button
                            aria-label={`Listen to recording ${take.id}`}
                            disabled={locked}
                            onClick={() =>
                              void play(take.url, "Earlier recording")
                            }
                          >
                            <Play size={15} />
                          </button>
                          {take.reviewStatus === "discarded" && (
                            <button
                              disabled={locked}
                              onClick={() => void review("restore", take.id)}
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              </>
            ) : (
              <section className="simple-session simple-empty">
                <h2>A little song starts with you.</h2>
                <p>
                  {data.actor === "mom"
                    ? "Your musical gifts are in your inbox."
                    : "Sing a short phrase you know."}
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    data.actor === "mom" ? setPage("inbox") : void createSong()
                  }
                >
                  {data.actor === "mom" ? "Open my inbox" : "Start a song"}
                </button>
              </section>
            )}
            <p className="simple-boundary">
              Harmony is made by analyzing and shifting your recorded voice. It
              may sound processed; it isn’t an AI-generated singer.
            </p>
          </>
        )}
        {page === "inbox" && (
          <>
            <div className="simple-intro">
              <span className="eyebrow">MADE FOR YOU</span>
              <h1>
                A song.
                <br />
                <em>A little closer.</em>
              </h1>
              <p>Your musical surprises, {person.name}.</p>
            </div>
            {data.surprises.length ? (
              data.surprises.map((gift) => (
                <section className="simple-session simple-gift" key={gift.id}>
                  <span className="mini-eyebrow">
                    {gift.playedAt
                      ? "HEARD"
                      : gift.openedAt
                        ? "OPENED"
                        : "A NEW SURPRISE"}
                  </span>
                  <h2>{gift.title}</h2>
                  <p>
                    From {gift.contributors.join(" & ")}
                    {gift.containsGeneratedHarmony
                      ? " · includes generated harmony"
                      : ""}
                  </p>
                  {gift.containsSamples && (
                    <p>Contains an instrumental test sample.</p>
                  )}
                  <blockquote>{gift.message}</blockquote>
                  <button
                    className="button primary"
                    disabled={locked}
                    onClick={() => void reveal(gift.id)}
                  >
                    <Play size={16} />
                    Listen to my surprise
                  </button>
                </section>
              ))
            ) : (
              <section className="simple-session simple-empty">
                <Gift size={32} />
                <h2>A little quiet for now.</h2>
                <p>Musical gifts will appear here when someone sends one.</p>
              </section>
            )}
          </>
        )}
        {page === "activity" && (
          <>
            <div className="simple-intro">
              <span className="eyebrow">BEHIND THE SONG</span>
              <h1>
                Real work.
                <br />
                <em>A little visible.</em>
              </h1>
              <p>Authenticated MCP · Streamable HTTP · {data.protocol}</p>
            </div>
            <section className="simple-session simple-log">
              <div className="simple-log-header">
                <h2>MCP activity</h2>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() =>
                    void task("Refreshing activity", async () => {
                      await refresh();
                    })
                  }
                >
                  Refresh
                </button>
              </div>
              {data.traces.length ? (
                data.traces.map((trace) => (
                  <div key={trace.id}>
                    <code>{trace.name}</code>
                    <span>{trace.ok ? "Completed" : trace.summary}</span>
                    <small>{trace.durationMs} ms</small>
                  </div>
                ))
              ) : (
                <p>Record a voice to see real tool calls here.</p>
              )}
              <p>
                Generation jobs run in the background. These timings measure
                tool execution, not audio rendering.
              </p>
            </section>
          </>
        )}
        {notice && (
          <div className="simple-notice" role="alert">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {sound.mode === "playing" && (
          <div className="simple-playback" role="status">
            <AudioLines size={16} />
            <span>
              {playing} · {time(sound.seconds)}
            </span>
            <button aria-label="Stop playback" onClick={stopPlayback}>
              <Square size={15} />
            </button>
          </div>
        )}
        {page !== "activity" && (
          <details className="simple-assistant">
            <summary>
              <Sparkles size={16} />
              Prefer to ask? Use your voice or type.
            </summary>
            <div className="simple-assistant-body">
              <p>
                {listening
                  ? "Listening…"
                  : reply ||
                    "Try ‘what tracks do I have?’, ‘play tracks 1 and 2’, or ‘sing with track 1’."}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendCommand();
                }}
              >
                <button
                  type="button"
                  className="icon-button"
                  aria-label={listening ? "Stop listening" : "Speak a command"}
                  disabled={locked}
                  onClick={voiceCommand}
                >
                  <Mic size={18} />
                </button>
                <input
                  aria-label="Ask HarmonyMate"
                  placeholder="What would you like to do?"
                  value={command}
                  disabled={locked}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <button
                  type="submit"
                  className="icon-button"
                  aria-label="Send command"
                  disabled={locked || !command.trim()}
                >
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    voiceOutput
                      ? "Turn spoken responses off"
                      : "Turn spoken responses on"
                  }
                  aria-pressed={voiceOutput}
                  onClick={() => {
                    if (voiceOutput) window.speechSynthesis?.cancel();
                    setVoiceOutput(!voiceOutput);
                  }}
                >
                  {voiceOutput ? <Volume2 size={17} /> : <VolumeX size={17} />}
                </button>
              </form>
              <label className="voice-language">
                Voice language
                <select
                  aria-label="Voice command language"
                  value={voiceLanguage}
                  onChange={(e) => setVoiceLanguage(e.target.value)}
                  disabled={listening || locked}
                >
                  <option value="en-US">English</option>
                  <option value="zh-TW">繁體中文</option>
                </select>
              </label>
              <small>
                {data.agentMode === "bedrock"
                  ? "Bedrock conversation"
                  : "Scripted conversation"}{" "}
                · Optional browser speech input may use your browser’s speech
                service.
              </small>
            </div>
          </details>
        )}
        <footer className="simple-footer">
          <span>One voice. A little possibility.</span>
          <div>
            <button
              disabled={locked}
              onClick={() =>
                setPage(page === "activity" ? "studio" : "activity")
              }
            >
              <Code2 size={14} />
              {page === "activity" ? "Back to studio" : "MCP activity"}
            </button>
            <button onClick={() => setShowHelp(true)}>
              <CircleHelp size={14} />
              How it works
            </button>
          </div>
          <small>Simulated Alexa+ experience · Browser microphone</small>
        </footer>
      </main>
      {(confirmation || showHelp) && (
        <div
          className="simple-overlay"
          onClick={() => {
            if (!locked) {
              setConfirmation(null);
              setShowHelp(false);
            }
          }}
        >
          <section
            className="simple-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="simple-dialog-close"
              aria-label="Close dialog"
              disabled={locked}
              onClick={() => {
                setConfirmation(null);
                setShowHelp(false);
              }}
            >
              <X size={20} />
            </button>
            {confirmation ? (
              <>
                <span className="mini-eyebrow">ONE LAST LOOK</span>
                <h2 id="dialog-title">Send this song to Mom?</h2>
                <p>
                  This exact version includes the selected tracks. Later
                  recordings won’t change it.
                </p>
                <blockquote>{confirmation.message}</blockquote>
                <button
                  className="button primary"
                  disabled={locked}
                  onClick={() =>
                    void task("Sending your song", async () => {
                      await post(
                        `/api/confirmations/${confirmation.id}/accept`,
                      );
                      setConfirmation(null);
                      setShowGift(false);
                      await refresh();
                      setNotice("Sent to Mom’s surprise inbox.");
                    })
                  }
                >
                  Yes, send this version
                </button>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => setConfirmation(null)}
                >
                  Keep it here for now
                </button>
              </>
            ) : (
              <>
                <span className="mini-eyebrow">JUST BRING YOUR VOICE</span>
                <h2 id="dialog-title">A little simpler.</h2>
                <ol>
                  <li>
                    <strong>Sing anything familiar.</strong> Record up to 30
                    seconds without background music.
                  </li>
                  <li>
                    <strong>Listen and choose.</strong> Keep, sing again, or
                    discard. Nothing replaces your kept version until you
                    choose.
                  </li>
                  <li>
                    <strong>Build your harmony.</strong> Choose high or low
                    thirds, fifths or sixths. Play individual tracks, select a
                    few to hear together, or sing a new part alongside them with
                    headphones.
                  </li>
                </ol>
                <p>
                  Local pitch processing changes the timbre and can sound
                  synthetic. It doesn’t compose an accompaniment or use a
                  generative AI model. Your original stays unchanged.
                </p>
                <p>
                  Alexa+ is simulated. Recording uses the browser microphone.
                  Demo singers are freely switchable; use test material.
                </p>
                <button
                  className="button primary"
                  onClick={() => setShowHelp(false)}
                >
                  Let’s sing
                  <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
