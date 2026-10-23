import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Gift,
  Headphones,
  Heart,
  Home,
  Loader2,
  Mic,
  Mic2,
  Music2,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  PEOPLE,
  type Actor,
  type AgentResponse,
  type Bootstrap,
  type Confirmation,
  type Part,
  type SongView,
  type ToolResult,
} from "../shared/types.ts";
import { SONG_SECONDS } from "../shared/music.ts";
import { api, post, tool } from "./api.ts";
import { audio, type AudioState } from "./audio/engine.ts";
import {
  Avatar,
  Brand,
  EmptyState,
  HeadphoneNote,
  MusicArt,
  Steps,
  TextLink,
  Waveform,
} from "./components.tsx";
import { recognitionConstructor, say, type RecognitionLike } from "./speech.ts";

type Page = "home" | "studio" | "inbox" | "activity";
type Chat = { id: string; role: "user" | "assistant"; text: string };
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const date = (n: string) =>
  new Date(n).toLocaleDateString("en", { month: "short", day: "numeric" });

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [page, setPage] = useState<Page>("home");
  const [selectedSong, setSelectedSong] = useState("");
  const [part, setPart] = useState<Part>("lead");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [sound, setSound] = useState<AudioState>(audio.state);
  const [headphones, setHeadphones] = useState(false);
  const recordCardRef = useRef<HTMLElement>(null);
  const [loadError, setLoadError] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [guideDuringRecording, setGuideDuringRecording] = useState(false);
  const [offset, setOffset] = useState(0);
  const [command, setCommand] = useState("");
  const [messages, setMessages] = useState<Chat[]>([]);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [listening, setListening] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [recordCard, setRecordCard] = useState(false);
  const [giftMessage, setGiftMessage] = useState(
    "A little song, from us to you.",
  );
  const [agentMode, setAgentMode] = useState<"bedrock" | "scripted">(
    "scripted",
  );
  const [mixToPlay, setMixToPlay] = useState<string>();
  const recognition = useRef<RecognitionLike | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const song = data?.songs.find((s) => s.id === selectedSong) ?? data?.songs[0];
  const isRecording = sound.mode === "recording" || sound.mode === "countdown";
  const isAudioBusy = sound.mode !== "idle";
  const interactiveBusy = !!busy || isRecording;
  const latestMix = song?.mixes.findLast((m) => m.status === "ready");
  const activeTakes = song?.takes.filter((t) => t.active) ?? [];
  const pendingMix = song?.mixes.find(
    (m) => m.status === "running" || m.status === "queued",
  );

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 5000);
  }, []);
  const refresh = useCallback(async () => {
    const next = await api<Bootstrap>("/api/bootstrap");
    setData(next);
    setAgentMode(next.agentMode);
    setSelectedSong((previous) =>
      next.songs.some((s) => s.id === previous)
        ? previous
        : (next.songs[0]?.id ?? ""),
    );
    return next;
  }, []);
  useEffect(() => {
    audio.onChange = setSound;
    void refresh()
      .then(async (next) => {
        setPart(next.actor === "ben" ? "harmony" : "lead");
        if (next.actor === "mom") {
          setPage("inbox");
          await tool("list_surprises", {});
          await refresh();
        }
      })
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : "The studio could not load.",
        ),
      )
      .finally(() => setInitializing(false));
    return () => {
      audio.stop();
      audio.onChange = () => {};
      recognition.current?.abort();
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const interval = setInterval(
      () => {
        if (!document.hidden) void refresh().catch(() => {});
      },
      pendingMix ? 900 : 10000,
    );
    return () => clearInterval(interval);
  }, [!!data, !!pendingMix, refresh]);
  useEffect(() => {
    if (!mixToPlay || !data || busy === "Recording") return;
    const mix = data.songs
      .flatMap((s) => s.mixes)
      .find((m) => m.id === mixToPlay);
    if (mix?.status === "ready" && mix.url) {
      setMixToPlay(undefined);
      window.speechSynthesis?.cancel();
      void audio.playUrl(mix.url).catch((error) => notify(error.message, true));
    } else if (mix?.status === "failed") {
      setMixToPlay(undefined);
      notify(mix.error || "The mix could not finish. Please try again.", true);
    }
  }, [data, mixToPlay, notify, busy]);
  useEffect(() => {
    if (!confirmation && !showHelp) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a, input, textarea, [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setConfirmation(null);
        setShowHelp(false);
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [!!confirmation, showHelp, !!busy]);
  const sayToUser = useCallback(
    (text: string) => {
      setMessages((messages) => [
        ...messages.slice(-11),
        { id: crypto.randomUUID(), role: "assistant", text },
      ]);
      if (voiceOutput && audio.state.mode === "idle") say(text);
    },
    [voiceOutput],
  );
  async function task(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Something went wrong.",
        true,
      );
    } finally {
      setBusy("");
    }
  }
  function silenceSpeech() {
    recognition.current?.abort();
    setListening(false);
    window.speechSynthesis?.cancel();
  }
  async function switchProfile(actor: Actor) {
    audio.stop();
    silenceSpeech();
    await post("/api/demo/profile", { actor });
    const next = await refresh();
    setMessages([]);
    setConfirmation(null);
    setRecordCard(false);
    setMixToPlay(undefined);
    setRecordingError("");
    setPart(actor === "ben" ? "harmony" : "lead");
    setPage(actor === "mom" ? "inbox" : "studio");
    if (next.actor === "mom") {
      await tool("list_surprises", {});
      await refresh();
    }
  }
  function showRecorder() {
    setPage("studio");
    setRecordCard(true);
    requestAnimationFrame(() =>
      recordCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
  }
  async function playGuide(which: Part) {
    if (!song) return;
    silenceSpeech();
    setPart(which);
    setMixToPlay(undefined);
    const result = await tool("get_harmony_guide", {
      songId: song.id,
      part: which,
    });
    await audio.playUrl(String(result.url));
    await refresh();
  }
  async function createSong() {
    await task("Creating your song", async () => {
      const result = await tool("create_song", {
        title: "A little closer",
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setSelectedSong((result.song as SongView).id);
      setPage("studio");
      sayToUser(
        "A fresh little song. Listen to the melody, then add your voice.",
      );
    });
  }
  async function record(sessionId?: string) {
    if (!song) return;
    await task("Recording", async () => {
      silenceSpeech();
      setRecordCard(false);
      setMixToPlay(undefined);
      setRecordingError("");
      try {
        const references = headphones
          ? song.takes.filter(
              (t) => t.active && !(t.actor === data!.actor && t.part === part),
            )
          : [];
        const guide = guideDuringRecording
          ? tool("get_harmony_guide", { songId: song.id, part }).then(
              (result) => String(result.url),
            )
          : undefined;
        // Begin permission and AudioContext activation inside this user gesture,
        // without waiting for tool calls or loading a reference first.
        const captured = audio.record(references, guide);
        const session = sessionId
          ? Promise.resolve({ sessionId })
          : tool("start_recording_session", { songId: song.id, part });
        const [result, recordingSession] = await Promise.all([
          captured,
          session,
        ]);
        setBusy("Saving your voice");
        const upload = await api<{ takeId: string }>(
          `/api/recordings/${recordingSession.sessionId}/audio`,
          {
            method: "POST",
            body: new Blob([new Uint8Array(result.wav)], { type: "audio/wav" }),
            headers: {
              "Content-Type": "audio/wav",
              "X-Offset-Ms": String(offset),
              "X-Capture": JSON.stringify(result.capture),
            },
          },
        );
        if (!upload.takeId)
          throw new Error("The upload did not finish. Please try again.");
        await refresh();
        notify(
          "Your voice is saved. Press the play button next to your take to listen.",
        );
        sayToUser(
          references.length
            ? "That’s your harmony. Let’s bring your voices together."
            : "Your voice is saved. Listen to your take, or add another part.",
        );
      } catch (error) {
        audio.stop();
        setRecordingError(
          error instanceof Error
            ? error.message
            : "Recording could not finish. Please try again.",
        );
        throw error;
      }
    });
  }
  async function mix() {
    if (!song) return;
    await task("Bringing voices together", async () => {
      silenceSpeech();
      audio.stop();
      const result = await tool("create_mix", { songId: song.id });
      setMixToPlay(String(result.jobId));
      await refresh();
      notify("Your mix is rendering. It will appear below in a moment.");
    });
  }
  async function prepareGift() {
    if (!song || !latestMix) return;
    await task("Preparing your gift", async () => {
      const result = await tool("create_surprise", {
        songId: song.id,
        mixId: latestMix.id,
        recipient: "mom",
        message: giftMessage,
      });
      setConfirmation(
        await api<Confirmation>(`/api/confirmations/${result.confirmationId}`),
      );
      await refresh();
    });
  }
  async function handleAgentAction(response: AgentResponse) {
    const action = response.action;
    if (!action) return;
    if (action.type === "guide") {
      setPart(action.part);
      setPage("studio");
      silenceSpeech();
      setMixToPlay(undefined);
      await audio.playUrl(action.url);
    }
    if (action.type === "record") {
      setPart(action.part);
      showRecorder();
    }
    if (action.type === "mix") {
      setPage("studio");
      setMixToPlay(action.jobId);
      notify("Bringing your voices together…");
    }
    if (action.type === "song") {
      setSelectedSong(action.songId);
      setPage("studio");
    }
    if (action.type === "share")
      setConfirmation(
        await api<Confirmation>(`/api/confirmations/${action.confirmationId}`),
      );
    if (action.type === "reveal") {
      silenceSpeech();
      await audio.playUrl(action.url, () => {
        void post(`/api/surprises/${action.surpriseId}/played`)
          .then(refresh)
          .catch(() => {});
      });
    }
  }
  async function sendCommand(text = command) {
    if (!text.trim() || interactiveBusy) return;
    setCommand("");
    setMessages((m) => [
      ...m.slice(-11),
      { id: crypto.randomUUID(), role: "user", text },
    ]);
    await task("Listening to your idea", async () => {
      const response = await post<AgentResponse>("/api/agent", {
        text,
        songId: song?.id,
      });
      setAgentMode(response.mode);
      await refresh();
      setAgentMode(response.mode);
      sayToUser(response.text);
      if (response.degraded)
        notify("AI unavailable. Studio buttons remain ready.", true);
      await handleAgentAction(response);
    });
  }
  async function voiceCommand() {
    if (interactiveBusy) return;
    if (listening) {
      recognition.current?.abort();
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      notify(
        "Voice commands aren’t supported here. Type your idea below.",
        true,
      );
      return;
    }
    silenceSpeech();
    audio.stop();
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = "en-US";
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) void sendCommand(text);
    };
    instance.onerror = (event) => {
      if (event.error !== "aborted")
        notify(
          `Voice input: ${event.error}. You can use text or the studio buttons.`,
          true,
        );
    };
    instance.onend = () => setListening(false);
    setListening(true);
    instance.start();
  }
  async function updateTake(takeId: string, update: Record<string, unknown>) {
    if (!song) return;
    await task("Updating take", async () => {
      await tool("set_track_mix", { songId: song.id, takeId, ...update });
      await refresh();
    });
  }
  async function loadSample() {
    if (!song) return;
    await task("Adding a sample tone", async () => {
      const session = await tool("start_recording_session", {
        songId: song.id,
        part,
      });
      await post(`/api/recordings/${session.sessionId}/sample`);
      await refresh();
      notify(
        "Instrumental sample added for testing. It is labeled as a sample, not a human voice.",
      );
    });
  }
  async function reveal(surpriseId: string) {
    await task("Opening your surprise", async () => {
      silenceSpeech();
      const result = await tool("reveal_surprise", { surpriseId });
      await audio.playUrl(String(result.url), () => {
        void post(`/api/surprises/${surpriseId}/played`)
          .then(refresh)
          .catch(() => {});
      });
      await refresh();
    });
  }

  if (initializing)
    return (
      <div className="initial-loading">
        <Brand />
        <Loader2 size={23} className="spin" />
        <span>Making a little room for music…</span>
      </div>
    );
  if (!data)
    return (
      <div className="initial-loading">
        <Brand />
        <p role="alert">{loadError || "The studio could not load."}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Try opening the studio again
        </button>
      </div>
    );
  const person = PEOPLE.find((p) => p.id === data.actor)!;
  const pageTitles: Record<Page, string> = {
    home: "Your singing space",
    studio: "The little studio",
    inbox: "Musical surprises",
    activity: "Behind the harmony",
  };
  const activeCount = activeTakes.length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-caption">A LITTLE MORE TOGETHER</div>
        <nav aria-label="Main navigation">
          {(
            [
              ["home", Home, "Your space"],
              ["studio", AudioLines, "The studio"],
              ["inbox", Gift, "Surprise inbox"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => {
                if (!isRecording && busy !== "Recording") setPage(id);
              }}
            >
              <Icon size={18} strokeWidth={1.6} />
              {label}
              {id === "inbox" &&
                data.surprises.filter((s) => !s.openedAt).length > 0 && (
                  <span className="nav-count">
                    {data.surprises.filter((s) => !s.openedAt).length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-songs">
          <div className="sidebar-section-title">
            YOUR SONGS
            <button
              onClick={() => void createSong()}
              aria-label="Create a new song"
              disabled={interactiveBusy}
            >
              <Plus size={16} />
            </button>
          </div>
          {data.songs.length ? (
            data.songs.map((s) => (
              <button
                className={`song-nav ${song?.id === s.id && page === "studio" ? "selected" : ""}`}
                key={s.id}
                onClick={() => {
                  if (!isRecording && busy !== "Recording") {
                    setSelectedSong(s.id);
                    setPage("studio");
                  }
                }}
              >
                <span className="song-nav-icon">
                  <Music2 size={14} />
                </span>
                <span>
                  {s.title}
                  <small>
                    {s.takes.filter((t) => t.active).length} voices · Original
                    exercise
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">Every song starts with a moment.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Heart size={20} strokeWidth={1.4} />
            <p>
              You don’t have to be
              <br />a singer to sing.
            </p>
            <span>JUST BE YOU.</span>
          </div>
          <button
            className={`nav-item quiet ${page === "activity" ? "active" : ""}`}
            onClick={() => setPage("activity")}
          >
            <Code2 size={17} />
            MCP activity
            <span className="live-dot" />
          </button>
          <button className="nav-item quiet" onClick={() => setShowHelp(true)}>
            <CircleHelp size={17} />A little help
          </button>
          <div className="sidebar-profile">
            <Avatar actor={data.actor} size="small" />
            <div className="profile-selection">
              <label htmlFor="demo-singer">Demo singer</label>
              <select
                id="demo-singer"
                aria-label="Demo singer"
                value={data.actor}
                onChange={(e) =>
                  void task("Changing singer", () =>
                    switchProfile(e.target.value as Actor),
                  )
                }
                disabled={interactiveBusy}
              >
                {PEOPLE.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <span>
            <span className="breadcrumb">Your space</span>
            <ChevronRight size={13} />
            {pageTitles[page]}
          </span>
          <div>
            <span className="simulation-label">
              <span /> Simulated Alexa+ experience
            </span>
            <button
              className="icon-button help-icon"
              onClick={() => setShowHelp(true)}
              title="About this experience"
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className={`main-content page-${page}`}>
          {page === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A MOMENT FOR MUSIC</span>
                  <h1>
                    Good to hear you, {person.name}
                    <span>.</span>
                  </h1>
                  <p>
                    No perfect voices needed. Just a little willingness to
                    begin.
                  </p>
                </div>
                <span className="today-label">
                  <span className="tiny-dot" /> YOUR KIND OF CREATIVE TIME
                </span>
              </div>
              <section className="hero-card">
                <div className="hero-copy">
                  <span className="pill">
                    <Sparkles size={13} /> SPONTANEOUSLY, TOGETHER
                  </span>
                  <h2>
                    That “let’s sing” feeling?
                    <br />
                    <em>Let’s follow it.</em>
                  </h2>
                  <p>
                    A melody to get you started. A harmony to find your feet.
                    <br />
                    And a familiar voice to make it feel like home.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="button primary"
                      onClick={() => {
                        if (song) {
                          setPage("studio");
                          void task("Finding your melody", () =>
                            playGuide("lead"),
                          );
                        } else void createSong();
                      }}
                      disabled={interactiveBusy}
                    >
                      <Mic2 size={17} />I feel like singing
                      <ArrowRight size={17} />
                    </button>
                    <button
                      className="button secondary"
                      onClick={showRecorder}
                      disabled={interactiveBusy || !song}
                    >
                      <Mic size={16} />
                      Record my voice
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setShowHelp(true)}
                    >
                      How it works
                      <ArrowUpRightIcon />
                    </button>
                  </div>
                  <div className="hero-footnote">
                    <span className="avatar-stack">
                      <Avatar actor="alex" size="small" />
                      <Avatar actor="ben" size="small" />
                      <Avatar actor="mom" size="small" />
                    </span>
                    <span>
                      One voice starts it. Another makes it <em>ours.</em>
                    </span>
                  </div>
                </div>
                <MusicArt />
              </section>
              <div className="home-section-header">
                <h2>A little song in the making</h2>
                <TextLink onClick={() => setPage("studio")}>
                  Open your studio
                </TextLink>
              </div>
              <div className="home-lower-grid">
                <section className="current-song-card">
                  <div className="song-cover">
                    <AudioLines size={33} strokeWidth={1.4} />
                    <span>
                      A LITTLE
                      <br />
                      CLOSER<span className="cover-star">✳</span>
                    </span>
                  </div>
                  <div className="current-song-info">
                    <span className="mini-eyebrow">YOUR SHARED MOMENT</span>
                    <h3>{song?.title ?? "Your first little song"}</h3>
                    <p>
                      {activeTakes.some((t) => t.source === "sample-tone")
                        ? `${activeCount} saved parts · includes sample guide tones.`
                        : activeCount
                          ? `${activeCount} independent ${activeCount === 1 ? "voice" : "voices"}, waiting to come together.`
                          : "A short original melody. A lovely place to start."}
                    </p>
                    <div className="song-meta">
                      <span>
                        <Clock3 size={13} /> {time(SONG_SECONDS)}
                      </span>
                      <span>112 BPM</span>
                      <span>C major</span>
                    </div>
                    <div className="song-card-bottom">
                      <span className="contributor-label">
                        <span className="avatar-stack">
                          <Avatar actor="alex" size="small" />
                          <Avatar actor="ben" size="small" />
                        </span>
                        Made for two (or just you)
                      </span>
                      <button
                        className="round-button"
                        aria-label="Open A little closer"
                        onClick={() => setPage("studio")}
                      >
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  </div>
                </section>
                <section className="moment-card">
                  <span className="moment-icon">
                    <Gift size={22} strokeWidth={1.4} />
                  </span>
                  <h3>
                    Some gifts
                    <br />
                    sound like <em>you.</em>
                  </h3>
                  <p>
                    Sing with someone you love.
                    <br />
                    Save it for someone you miss.
                  </p>
                  <TextLink onClick={() => setPage("inbox")}>
                    A musical surprise
                  </TextLink>
                  <Heart
                    className="moment-heart"
                    size={100}
                    strokeWidth={0.6}
                  />
                </section>
              </div>
              <div className="principles">
                <span>
                  <Mic2 size={15} />
                  Your real voice
                </span>
                <span>
                  <Headphones size={15} />A little harmony guidance
                </span>
                <span>
                  <ShieldCheck size={15} />
                  Shared only when you choose
                </span>
              </div>
            </>
          )}

          {page === "studio" && (
            <>
              <div className="page-heading studio-heading">
                <div>
                  <span className="eyebrow">SMALL SONG. SHARED FEELING.</span>
                  <h1>
                    {song?.title ?? "Make a little music"}
                    <span>.</span>
                  </h1>
                  <p>An original eight-bar melody. Make it sound like you.</p>
                </div>
                <button
                  className="button primary small studio-record-shortcut"
                  onClick={showRecorder}
                  disabled={interactiveBusy || !song}
                >
                  <Mic size={15} />
                  Record a voice
                </button>
                <button
                  className="button secondary small"
                  onClick={() => void createSong()}
                  disabled={interactiveBusy}
                >
                  <Plus size={15} />
                  New song
                </button>
              </div>
              {song ? (
                <>
                  <Steps stage={latestMix ? 2 : activeCount ? 1 : 0} />
                  <div className="studio-grid">
                    <div className="studio-main">
                      <section className="guide-card">
                        <div className="guide-icon">
                          <Music2 size={23} strokeWidth={1.5} />
                        </div>
                        <div className="guide-copy">
                          <span className="mini-eyebrow">
                            LISTEN FIRST. SING SECOND.
                          </span>
                          <h3>Find your part</h3>
                          <p>Pick a voice. Hum along. There’s no rush.</p>
                        </div>
                        <div className="guide-buttons">
                          <button
                            className={`button ${part === "lead" ? "selected-part" : "secondary"} small`}
                            onClick={() =>
                              void task("Playing melody", () =>
                                playGuide("lead"),
                              )
                            }
                            disabled={interactiveBusy}
                          >
                            <Play size={13} />
                            Melody
                          </button>
                          <button
                            className={`button ${part === "harmony" ? "selected-part harmony" : "secondary"} small`}
                            onClick={() =>
                              void task("Playing harmony", () =>
                                playGuide("harmony"),
                              )
                            }
                            disabled={interactiveBusy}
                          >
                            <Play size={13} />
                            Lower harmony
                          </button>
                        </div>
                        <small className="guide-disclaimer">
                          Curated guide tones · Original composition · 112 BPM ·
                          C major
                        </small>
                      </section>
                      <section className="tracks-card">
                        <div className="section-top">
                          <div>
                            <span className="mini-eyebrow">
                              A LITTLE MORE US
                            </span>
                            <h3>Your voices</h3>
                          </div>
                          <span className="soft-tag">
                            {activeCount} / 8 in this mix
                          </span>
                        </div>
                        {song.takes.length ? (
                          <div className="track-list">
                            {song.takes
                              .filter((t) => t.active)
                              .map((take) => (
                                <div
                                  className={`track-row ${take.part === "harmony" ? "harmony-track" : ""}`}
                                  key={take.id}
                                >
                                  <div className="track-info">
                                    <Avatar actor={take.actor} size="small" />
                                    <div>
                                      <strong>
                                        {
                                          PEOPLE.find(
                                            (p) => p.id === take.actor,
                                          )?.name
                                        }
                                        ’s{" "}
                                        {take.part === "lead"
                                          ? "melody"
                                          : "harmony"}
                                      </strong>
                                      <span>
                                        {take.source === "sample-tone"
                                          ? "SAMPLE GUIDE TONE"
                                          : "HUMAN RECORDING"}{" "}
                                        · {time(take.duration)}
                                      </span>
                                    </div>
                                    <button
                                      className="icon-button"
                                      title={`Listen to ${take.actor}'s take`}
                                      aria-label={`Listen to ${take.actor}'s take`}
                                      onClick={() =>
                                        void task("Playing take", async () => {
                                          silenceSpeech();
                                          await audio.playUrl(take.url);
                                        })
                                      }
                                      disabled={interactiveBusy}
                                    >
                                      <Play size={15} />
                                    </button>
                                  </div>
                                  <Waveform
                                    url={take.url}
                                    color={
                                      take.part === "lead"
                                        ? "#b5654e"
                                        : "#89835e"
                                    }
                                    progress={
                                      sound.mode === "playing"
                                        ? sound.progress
                                        : 0
                                    }
                                  />
                                  <div className="track-controls">
                                    <button
                                      className={`icon-button ${take.muted ? "muted" : ""}`}
                                      title={
                                        take.muted ? "Unmute take" : "Mute take"
                                      }
                                      aria-label={
                                        take.muted ? "Unmute take" : "Mute take"
                                      }
                                      onClick={() =>
                                        void updateTake(take.id, {
                                          muted: !take.muted,
                                        })
                                      }
                                      disabled={
                                        interactiveBusy ||
                                        (data.actor !== song.owner &&
                                          data.actor !== take.actor)
                                      }
                                    >
                                      {take.muted ? (
                                        <VolumeX size={15} />
                                      ) : (
                                        <Volume2 size={15} />
                                      )}
                                    </button>
                                    <input
                                      aria-label={`${take.actor} volume`}
                                      type="range"
                                      min="0"
                                      max="1.5"
                                      step="0.05"
                                      defaultValue={take.gain}
                                      key={`${take.id}:${take.gain}`}
                                      onPointerUp={(e) =>
                                        void updateTake(take.id, {
                                          gain: Number(e.currentTarget.value),
                                        })
                                      }
                                      onKeyUp={(e) => {
                                        if (
                                          e.key.startsWith("Arrow") ||
                                          e.key === "Home" ||
                                          e.key === "End"
                                        )
                                          void updateTake(take.id, {
                                            gain: Number(e.currentTarget.value),
                                          });
                                      }}
                                      disabled={
                                        interactiveBusy ||
                                        (data.actor !== song.owner &&
                                          data.actor !== take.actor)
                                      }
                                    />
                                    <span>{Math.round(take.gain * 100)}%</span>
                                    <details className="timing-control">
                                      <summary>
                                        <Settings2 size={13} />
                                        Timing
                                      </summary>
                                      <div>
                                        <label>
                                          Offset{" "}
                                          <strong>
                                            {take.offsetMs > 0 ? "+" : ""}
                                            {take.offsetMs} ms
                                          </strong>
                                        </label>
                                        <input
                                          aria-label={`${take.actor} timing offset`}
                                          type="range"
                                          min="-1500"
                                          max="1500"
                                          step="10"
                                          defaultValue={take.offsetMs}
                                          key={`${take.id}:${take.offsetMs}`}
                                          onPointerUp={(e) =>
                                            void updateTake(take.id, {
                                              offsetMs: Number(
                                                e.currentTarget.value,
                                              ),
                                            })
                                          }
                                          onKeyUp={(e) => {
                                            if (e.key.startsWith("Arrow"))
                                              void updateTake(take.id, {
                                                offsetMs: Number(
                                                  e.currentTarget.value,
                                                ),
                                              });
                                          }}
                                          disabled={
                                            interactiveBusy ||
                                            (data.actor !== song.owner &&
                                              data.actor !== take.actor)
                                          }
                                        />
                                        <small>− earlier · + later</small>
                                      </div>
                                    </details>
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="empty-track">
                            <div className="empty-track-label">
                              <span className="empty-track-mic">
                                <Mic2 size={17} />
                              </span>
                              <span>
                                Your melody goes here
                                <small>
                                  Every shared song begins with one voice.
                                </small>
                              </span>
                            </div>
                            <Waveform />
                          </div>
                        )}
                        <div className="add-voice-row">
                          <button
                            onClick={() => {
                              setPart(
                                data.actor === "ben"
                                  ? "harmony"
                                  : activeCount
                                    ? "harmony"
                                    : "lead",
                              );
                              showRecorder();
                            }}
                            disabled={interactiveBusy}
                          >
                            <Plus size={17} />
                            Add your voice
                            <span>It doesn’t need to be perfect.</span>
                          </button>
                        </div>
                        {song.takes.some((t) => !t.active) && (
                          <details className="takes-history">
                            <summary>
                              {song.takes.filter((t) => !t.active).length}{" "}
                              previous takes preserved
                              <ChevronDown size={13} />
                            </summary>
                            {song.takes
                              .filter((t) => !t.active)
                              .map((t) => (
                                <div key={t.id}>
                                  <span>
                                    {PEOPLE.find((p) => p.id === t.actor)?.name}{" "}
                                    · {t.part} · {time(t.duration)}
                                    {t.source === "sample-tone"
                                      ? " · sample tone"
                                      : ""}
                                  </span>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void task("Playing earlier take", () =>
                                        audio.playUrl(t.url),
                                      )
                                    }
                                    disabled={interactiveBusy}
                                  >
                                    <Play size={12} />
                                    Listen
                                  </button>
                                </div>
                              ))}
                          </details>
                        )}
                        <div className="studio-transport">
                          <button
                            className="round-button dark"
                            aria-label={
                              sound.mode === "playing"
                                ? "Stop playback"
                                : "Preview all active takes"
                            }
                            onClick={() =>
                              sound.mode === "playing"
                                ? audio.stop()
                                : void task("Playing your voices", async () => {
                                    silenceSpeech();
                                    await audio.playTracks(activeTakes);
                                  })
                            }
                            disabled={interactiveBusy || !activeCount}
                          >
                            {sound.mode === "playing" ? (
                              <Square size={14} fill="currentColor" />
                            ) : (
                              <Play size={16} fill="currentColor" />
                            )}
                          </button>
                          <div className="transport-time">
                            <strong>{time(sound.seconds)}</strong>
                            <span>/ {time(SONG_SECONDS)}</span>
                          </div>
                          <div className="transport-line">
                            <span
                              style={{ width: `${sound.progress * 100}%` }}
                            />
                          </div>
                          <button
                            className="button primary small"
                            onClick={() => void mix()}
                            disabled={
                              interactiveBusy || !activeCount || !!pendingMix
                            }
                          >
                            {pendingMix ? (
                              <Loader2 className="spin" size={15} />
                            ) : (
                              <AudioLines size={15} />
                            )}{" "}
                            {pendingMix ? "Mixing…" : "Bring us together"}
                          </button>
                        </div>
                      </section>
                      {(latestMix ||
                        pendingMix ||
                        song.mixes.some((m) => m.status === "failed")) && (
                        <section className="finished-mix">
                          <span className="mix-heart">
                            <Heart size={22} strokeWidth={1.4} />
                          </span>
                          <div>
                            <span className="mini-eyebrow">
                              {pendingMix
                                ? "SOMETHING GOOD IS COMING"
                                : latestMix
                                  ? "THERE YOU ARE, TOGETHER"
                                  : "LET’S TRY THAT AGAIN"}
                            </span>
                            <h3>
                              {pendingMix
                                ? "Bringing your voices together…"
                                : latestMix
                                  ? "Your little harmony"
                                  : "This mix needs another try"}
                            </h3>
                            <p>
                              {latestMix?.tracks.some(
                                (t) => t.source === "sample-tone",
                              )
                                ? "Contains labeled sample guide tones."
                                : latestMix
                                  ? `${latestMix.tracks.length} independent ${latestMix.tracks.length === 1 ? "voice" : "voices"}. A version worth keeping.`
                                  : pendingMix
                                    ? "Your original takes stay safe."
                                    : "Check ffmpeg, then create a new mix."}
                            </p>
                          </div>
                          {latestMix && (
                            <div className="mix-actions">
                              <button
                                className="button secondary small"
                                onClick={() =>
                                  void task(
                                    "Playing finished mix",
                                    async () => {
                                      silenceSpeech();
                                      await audio.playUrl(latestMix.url!);
                                    },
                                  )
                                }
                                disabled={interactiveBusy}
                              >
                                <Play size={14} />
                                Listen
                              </button>
                              <a
                                className="icon-button"
                                href={latestMix.url}
                                download="HarmonyMate-A-little-closer.wav"
                                title="Download mix"
                              >
                                <ArrowDownToLine size={17} />
                              </a>
                            </div>
                          )}
                        </section>
                      )}
                    </div>
                    <aside className="studio-side">
                      <section
                        ref={recordCardRef}
                        className={`record-card ${isRecording ? "is-recording" : ""} ${recordCard ? "highlight" : ""}`}
                      >
                        <span className="mini-eyebrow">
                          YOUR VOICE BELONGS HERE
                        </span>
                        <div className="record-orb">
                          {isRecording ? (
                            <span className="countdown-number">
                              {sound.mode === "countdown" ? (
                                sound.countdown
                              ) : (
                                <AudioLines size={35} />
                              )}
                            </span>
                          ) : (
                            <Mic2 size={32} strokeWidth={1.2} />
                          )}
                          <span className="orb-ring" />
                        </div>
                        <h3>
                          {sound.mode === "countdown"
                            ? "Here we go…"
                            : sound.mode === "recording"
                              ? "Just be you."
                              : sound.mode === "requesting"
                                ? "Let’s turn on your mic."
                                : "One voice. All yours."}
                        </h3>
                        <p>
                          {isRecording
                            ? sound.mode === "countdown"
                              ? "Breathe in. Your song is about to begin."
                              : "Your microphone is recording a separate voice track."
                            : sound.mode === "requesting"
                              ? "Allow microphone access in your browser. You can cancel and retry if no prompt appears."
                              : sound.mode === "loading" && busy === "Recording"
                                ? "Your microphone is ready. Preparing your recording…"
                                : "Press record and allow your microphone. Headphones are only needed when playing guides or other voices."}
                        </p>
                        <div
                          className="part-picker"
                          role="group"
                          aria-label="Choose recording part"
                        >
                          <button
                            className={part === "lead" ? "active" : ""}
                            onClick={() => setPart("lead")}
                            disabled={interactiveBusy}
                          >
                            Melody
                          </button>
                          <button
                            className={part === "harmony" ? "active" : ""}
                            onClick={() => setPart("harmony")}
                            disabled={interactiveBusy}
                          >
                            Harmony
                          </button>
                        </div>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={headphones}
                            onChange={(e) => setHeadphones(e.target.checked)}
                            disabled={interactiveBusy}
                          />
                          <span>Play existing voices in my headphones</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={guideDuringRecording}
                            onChange={(e) =>
                              setGuideDuringRecording(e.target.checked)
                            }
                            disabled={interactiveBusy}
                          />
                          <span>Play my guide while I sing</span>
                        </label>
                        {sound.mode === "requesting" ||
                        (sound.mode === "loading" && busy === "Recording") ? (
                          <button
                            className="button secondary full"
                            onClick={() => audio.stop()}
                          >
                            <X size={15} />
                            Cancel microphone setup
                          </button>
                        ) : isRecording ? (
                          <button
                            className="button primary full recording-button"
                            onClick={() => audio.finishRecording()}
                          >
                            <Square size={14} fill="currentColor" />
                            {sound.mode === "countdown"
                              ? "Stop count-in"
                              : "Finish take"}
                            <span>{time(sound.seconds)}</span>
                          </button>
                        ) : (
                          <button
                            className="button primary full"
                            onClick={() => void record()}
                            disabled={interactiveBusy}
                          >
                            <Mic size={16} />
                            {busy === "Saving your voice"
                              ? "Saving your voice…"
                              : busy === "Recording"
                                ? "Preparing microphone…"
                                : "Record my part"}
                            {(busy === "Recording" ||
                              busy === "Saving your voice") && (
                              <Loader2 size={15} className="spin" />
                            )}
                          </button>
                        )}
                        {recordingError && (
                          <div className="recording-error" role="alert">
                            <strong>Let’s get your microphone working.</strong>
                            <p>{recordingError}</p>
                            <small>
                              You can retry Record my part. If needed, open{" "}
                              {window.location.origin} in Chrome or Edge and
                              allow the microphone there.
                            </small>
                          </div>
                        )}
                        {isRecording && (
                          <div className="input-level">
                            <span style={{ width: `${sound.level * 100}%` }} />
                          </div>
                        )}
                        <span className="record-caption">
                          {isRecording
                            ? "Microphone audio stays on its own track."
                            : `3-second count-in · ${time(SONG_SECONDS)} recording · Browser microphone`}
                        </span>
                        <details className="record-advanced">
                          <summary>
                            <Settings2 size={12} />
                            Recording settings
                          </summary>
                          <label>
                            Manual timing correction{" "}
                            <strong>
                              {offset > 0 ? "+" : ""}
                              {offset} ms
                            </strong>
                            <input
                              type="range"
                              min="-1000"
                              max="1000"
                              step="10"
                              value={offset}
                              onChange={(e) =>
                                setOffset(Number(e.target.value))
                              }
                              disabled={interactiveBusy}
                            />
                          </label>
                          <small>
                            Fine-tune after a loopback test. Hardware latency is
                            not automatically calibrated.
                          </small>
                          <button
                            className="text-button sample-button"
                            onClick={() =>
                              void task("Checking browser audio", async () => {
                                const result = await audio.selfCheck();
                                notify(
                                  `Audio engine passed: ${result.samples} samples at ${result.sampleRate} Hz, starting exactly at T0. No microphone used.`,
                                );
                              })
                            }
                            disabled={interactiveBusy}
                          >
                            Check audio engine (no microphone)
                          </button>
                          <button
                            className="text-button sample-button"
                            onClick={() => void loadSample()}
                            disabled={interactiveBusy}
                          >
                            Add a sample guide tone for testing
                          </button>
                          <small>
                            Instrumental test data. Never labeled as a human
                            voice.
                          </small>
                        </details>
                      </section>
                      <section className="share-card">
                        <span className="share-card-title">
                          <Gift size={17} />
                          Save a smile for someone
                        </span>
                        <p>This mix could make someone’s day.</p>
                        <label htmlFor="gift-message" className="sr-only">
                          Gift message
                        </label>
                        <textarea
                          id="gift-message"
                          maxLength={240}
                          value={giftMessage}
                          onChange={(e) => setGiftMessage(e.target.value)}
                          placeholder="A little note for Mom…"
                          disabled={interactiveBusy}
                        />
                        <button
                          className="button secondary full small"
                          onClick={() => void prepareGift()}
                          disabled={
                            interactiveBusy ||
                            !latestMix ||
                            song.owner !== data.actor
                          }
                        >
                          <Heart size={14} />
                          Make a surprise for Mom
                          <ArrowRight size={14} />
                        </button>
                        <small>
                          {song.owner !== data.actor
                            ? "Alex, the song owner, can send this gift."
                            : "Only Mom can open it. You’ll confirm first."}
                        </small>
                      </section>
                    </aside>
                  </div>
                  <HeadphoneNote />
                </>
              ) : (
                <EmptyState kind="mic" title="Every song starts somewhere.">
                  Create a song above and give it your voice.
                </EmptyState>
              )}
            </>
          )}

          {page === "inbox" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SOME THINGS ARE BETTER SUNG</span>
                  <h1>
                    A little love, delivered<span>.</span>
                  </h1>
                  <p>Voices you know. A moment just for you.</p>
                </div>
                <span className="inbox-badge">
                  <ShieldCheck size={14} />
                  Only your gifts appear here
                </span>
              </div>
              {data.surprises.length ? (
                <div className="gift-grid">
                  {data.surprises.map((gift) => (
                    <section className="gift-card" key={gift.id}>
                      <div className="gift-art">
                        <span className="gift-ribbon" />
                        <Heart size={55} strokeWidth={0.9} />
                        <span className="gift-art-caption">
                          a little something
                          <br />
                          <em>just for you</em>
                        </span>
                      </div>
                      <div className="gift-content">
                        <span className="mini-eyebrow">
                          {gift.playedAt
                            ? "A MOMENT TO KEEP"
                            : "YOU HAVE A MUSICAL SURPRISE"}
                        </span>
                        <h2>{gift.title}</h2>
                        <p className="gift-note">“{gift.message}”</p>
                        {gift.containsSamples && (
                          <p className="sample-notice">
                            Instrumental sample preview · contains guide tones
                          </p>
                        )}
                        <div className="gift-from">
                          <span className="avatar-stack">
                            {[
                              ...new Set([
                                gift.sender,
                                ...(gift.contributors.includes("Ben")
                                  ? ["ben" as Actor]
                                  : []),
                              ]),
                            ].map((p) => (
                              <Avatar key={p} actor={p} size="small" />
                            ))}
                          </span>
                          <span>
                            With love, from{" "}
                            {gift.contributors.join(" & ") ||
                              PEOPLE.find((p) => p.id === gift.sender)?.name}
                            <small>
                              {date(gift.createdAt)} · A private, saved mix
                            </small>
                          </span>
                        </div>
                        <button
                          className="button primary full"
                          onClick={() => void reveal(gift.id)}
                          disabled={interactiveBusy}
                        >
                          <Play size={15} />
                          {gift.playedAt
                            ? "Hear it again"
                            : "Listen to my surprise"}
                          <Heart size={14} />
                        </button>
                        <span className="gift-caption">
                          {gift.playedAt
                            ? "Heard, and held close."
                            : gift.openedAt
                              ? "Opened. Take your time listening."
                              : "Open when you’re ready. We won’t play it without you."}
                        </span>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <>
                  <EmptyState kind="gift" title="A little quiet, for now.">
                    When someone saves a song for you, it’ll be waiting right
                    here.
                    <br />
                    Try Alex’s profile to create a musical gift for Mom.
                  </EmptyState>
                  <div className="inbox-explainer">
                    <span>
                      01 <strong>A voice becomes a song.</strong>
                    </span>
                    <ChevronRight size={16} />
                    <span>
                      02 <strong>A song becomes a gift.</strong>
                    </span>
                    <ChevronRight size={16} />
                    <span>
                      03 <strong>Someone feels a little closer.</strong>
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {page === "activity" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    REAL TOOLS. REAL LITTLE MOMENTS.
                  </span>
                  <h1>
                    Behind the harmony<span>.</span>
                  </h1>
                  <p>
                    Actual calls from this profile through the MCP client and
                    server.
                  </p>
                </div>
                <button
                  className="button secondary small"
                  onClick={() =>
                    void task("Refreshing activity", async () => {
                      await refresh();
                    })
                  }
                >
                  <Code2 size={15} />
                  Refresh
                </button>
              </div>
              <div className="activity-overview">
                <div>
                  <span className="mini-eyebrow">TRANSPORT</span>
                  <strong>Streamable HTTP</strong>
                  <span>Authenticated · Stateless · /mcp</span>
                </div>
                <div>
                  <span className="mini-eyebrow">PROTOCOL TARGET</span>
                  <strong>{data.protocol}</strong>
                  <span>SDK initialization verified in smoke test</span>
                </div>
                <div>
                  <span className="mini-eyebrow">CONVERSATION</span>
                  <strong>
                    {agentMode === "bedrock"
                      ? "Amazon Bedrock"
                      : "Scripted simulator"}
                  </strong>
                  <span>
                    {agentMode === "bedrock"
                      ? "Converse tool-use · No native Alexa connection"
                      : "Explicit intents · No LLM configured"}
                  </span>
                </div>
              </div>
              <section className="activity-card">
                <div className="section-top">
                  <h3>Tool call log</h3>
                  <span className="soft-tag">
                    {data.traces.length} recent calls
                  </span>
                </div>
                {data.traces.length ? (
                  <div className="trace-table">
                    <div className="trace-head">
                      <span>TOOL</span>
                      <span>RESULT</span>
                      <span>DURATION</span>
                      <span>TIME</span>
                    </div>
                    {data.traces.map((trace) => (
                      <div className="trace-row" key={trace.id}>
                        <span>
                          <span
                            className={`trace-dot ${trace.ok ? "" : "failed"}`}
                          />
                          <code>{trace.name}</code>
                        </span>
                        <span title={trace.summary}>
                          {trace.ok ? "Completed" : trace.summary}
                        </span>
                        <span>{trace.durationMs} ms</span>
                        <span>
                          {new Date(trace.at).toLocaleTimeString("en", {
                            hour12: false,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    kind="mic"
                    title="Your first note is still ahead."
                  >
                    Play a guide or record a voice. Real tool calls will appear
                    here.
                  </EmptyState>
                )}
              </section>
              <div className="implementation-note">
                <ShieldCheck size={17} />
                <p>
                  Tool execution, file storage, recording, access checks, and
                  ffmpeg mixing are real. The Alexa+ interface is simulated.
                  These timings measure server tool execution, not total network
                  latency. Shared demo accounts are intended for test material.
                </p>
              </div>
            </>
          )}

          {page !== "activity" && (
            <section className="assistant-panel">
              <div className="assistant-heading">
                <span className="assistant-icon">
                  <Sparkles size={17} />
                </span>
                <div>
                  <strong>A little guidance, whenever you need it.</strong>
                  <span>
                    {agentMode === "bedrock"
                      ? "Bedrock-powered simulator"
                      : "Scripted simulator mode"}{" "}
                    ·{" "}
                    {listening
                      ? "Listening…"
                      : "Try saying what you’d like to do."}
                  </span>
                </div>
                <button
                  className={`icon-button ${voiceOutput ? "enabled" : ""}`}
                  onClick={() => {
                    if (voiceOutput) window.speechSynthesis?.cancel();
                    setVoiceOutput(!voiceOutput);
                  }}
                  title={
                    voiceOutput
                      ? "Turn spoken responses off"
                      : "Turn spoken responses on"
                  }
                  aria-label={
                    voiceOutput
                      ? "Turn spoken responses off"
                      : "Turn spoken responses on"
                  }
                  aria-pressed={voiceOutput}
                >
                  {voiceOutput ? <Volume2 size={17} /> : <VolumeX size={17} />}
                </button>
              </div>
              {messages.length > 0 && (
                <div className="chat-messages" aria-live="polite">
                  {messages.slice(-4).map((m) => (
                    <div className={`chat-message ${m.role}`} key={m.id}>
                      <span>
                        {m.role === "user" ? person.name : "HarmonyMate"}
                      </span>
                      <p>{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="command-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendCommand();
                }}
              >
                <button
                  type="button"
                  className={`voice-button ${listening ? "listening" : ""}`}
                  onClick={() => void voiceCommand()}
                  title={listening ? "Stop listening" : "Speak a command"}
                  aria-label={listening ? "Stop listening" : "Speak a command"}
                  disabled={interactiveBusy}
                >
                  <Mic size={18} />
                </button>
                <input
                  aria-label="Ask HarmonyMate"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={
                    data.actor === "mom"
                      ? "“Do I have a musical surprise?”"
                      : "“Alexa, I feel like singing…”"
                  }
                  disabled={interactiveBusy}
                />
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send command"
                  disabled={!command.trim() || interactiveBusy}
                >
                  {busy === "Listening to your idea" ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              </form>
              <div className="suggestion-chips">
                {(data.actor === "mom"
                  ? ["Do I have a musical surprise?", "Play my surprise"]
                  : [
                      "I feel like singing",
                      "Teach me the lower harmony",
                      "Let us hear it together",
                    ]
                ).map((text) => (
                  <button
                    key={text}
                    onClick={() => void sendCommand(text)}
                    disabled={interactiveBusy}
                  >
                    {text}
                    <ArrowRight size={12} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
        <footer className="app-footer">
          <span>A little guidance. Your voices, together.</span>
          <span>
            Original music · Browser audio · Made with care <Heart size={11} />
          </span>
        </footer>
      </div>

      {isAudioBusy &&
        !isRecording &&
        sound.mode !== "requesting" &&
        busy !== "Recording" && (
          <div className="now-playing">
            <span className="playing-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              {sound.mode === "loading"
                ? "Getting the audio ready…"
                : "A little closer"}
              <small>
                {sound.mode === "loading"
                  ? "One moment"
                  : `${time(sound.seconds)} · Playing in your browser`}
              </small>
            </span>
            <button
              className="icon-button"
              onClick={() => audio.stop()}
              aria-label="Stop audio"
            >
              <Square size={15} fill="currentColor" />
            </button>
          </div>
        )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop" onClick={() => setConfirmation(null)}>
          <section
            className="modal gift-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setConfirmation(null)}
              aria-label="Close gift confirmation"
            >
              <X size={19} />
            </button>
            <span className="modal-symbol">
              <Gift size={28} strokeWidth={1.3} />
            </span>
            <span className="mini-eyebrow">SOMETHING ONLY YOU CAN GIVE</span>
            <h2 id="confirm-title">
              A little song for{" "}
              {PEOPLE.find((p) => p.id === confirmation.recipient)?.name}.
            </h2>
            <p>
              You’re sharing this saved version of{" "}
              <strong>{song?.title ?? "A little closer"}</strong> with{" "}
              {PEOPLE.find((p) => p.id === confirmation.recipient)?.name}. Only
              their demo profile can open the gift.
            </p>
            <blockquote>“{confirmation.message}”</blockquote>
            <div className="confirmation-version">
              <ShieldCheck size={14} />
              <span>
                Fixed mix version · {confirmation.mixId.slice(0, 8)}
                <br />
                Later takes won’t change this gift.
              </span>
            </div>
            <button
              className="button primary full"
              onClick={() =>
                void task("Sending your little song", async () => {
                  await post(`/api/confirmations/${confirmation.id}/accept`);
                  setConfirmation(null);
                  await refresh();
                  notify(
                    "A little love, delivered. Mom’s surprise is waiting in her inbox.",
                  );
                })
              }
              disabled={!!busy}
            >
              <Heart size={15} />
              {busy
                ? "Sending…"
                : `Yes, send this song to ${PEOPLE.find((p) => p.id === confirmation.recipient)?.name}`}
              <ArrowRight size={16} />
            </button>
            <button
              className="text-button full"
              onClick={() => setConfirmation(null)}
              disabled={!!busy}
            >
              Keep it here for now
            </button>
          </section>
        </div>
      )}
      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setShowHelp(false)}
              aria-label="Close help"
            >
              <X size={19} />
            </button>
            <span className="mini-eyebrow">
              NOT A RECORDING EXPERT? PERFECT.
            </span>
            <h2 id="help-title">Just bring your voice.</h2>
            <div className="help-step">
              <span>01</span>
              <div>
                <h3>Listen to a little melody</h3>
                <p>
                  Start with our original 17-second song. The lower harmony
                  guide helps you learn a second part.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span>02</span>
              <div>
                <h3>Sing it your way</h3>
                <p>
                  Put on wired headphones, allow your browser microphone, and
                  record. Listen to an earlier voice while adding yours. Retakes
                  preserve the originals.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span>03</span>
              <div>
                <h3>Make it a shared moment</h3>
                <p>
                  Bring your voices together in a real mix. Alex can save a
                  version as a gift for Mom. Switch demo singers in the profile
                  selector. No login or password is needed.
                </p>
              </div>
            </div>
            <div className="help-boundary">
              <strong>A clear little note</strong>
              <p>
                This is a simulated Alexa+ experience. Your browser handles
                recording; a real MCP server handles tools and ffmpeg mixes the
                tracks. It does not connect to an Echo or record through Alexa.
                Without AWS configuration, the conversation uses labeled
                scripted intents.
              </p>
            </div>
            <button
              className="button primary full"
              onClick={() => setShowHelp(false)}
            >
              Let’s sing
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={14} style={{ transform: "rotate(-40deg)" }} />;
}
