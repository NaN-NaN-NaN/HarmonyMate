import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ArrowUpRight,
  Check,
  Headphones,
  Heart,
  Mic2,
  Music2,
  Sparkles,
} from "lucide-react";
import { PEOPLE, type Actor } from "../shared/types.ts";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-icon">
        <AudioLines size={23} strokeWidth={1.7} />
      </span>
      <span>
        harmony<span className="brand-light">mate</span>
        <span className="brand-period">.</span>
      </span>
    </div>
  );
}
export function Avatar({
  actor,
  size = "normal",
}: {
  actor: Actor;
  size?: "small" | "normal" | "large";
}) {
  return (
    <span
      className={`avatar avatar-${actor} avatar-${size}`}
      aria-label={PEOPLE.find((p) => p.id === actor)?.name}
    >
      {actor === "mom" ? "M" : actor[0].toUpperCase()}
    </span>
  );
}
export function MusicArt({ mini = false }: { mini?: boolean }) {
  return (
    <div className={`music-art ${mini ? "mini" : ""}`} aria-hidden="true">
      <span className="art-orbit orbit-one" />
      <span className="art-orbit orbit-two" />
      <div className="art-disc">
        <div className="disc-rings" />
        <div className="disc-label">
          <AudioLines size={38} strokeWidth={1.2} />
          <span>
            OUR VOICES
            <br />
            TOGETHER
          </span>
        </div>
      </div>
      <div className="art-note note-one">
        <Music2 size={30} />
      </div>
      <div className="art-note note-two">
        <Heart size={21} />
      </div>
      <div className="art-caption">
        <span className="tiny-dot" /> A LITTLE CLOSER{" "}
        <span>00:17 / SIDE A</span>
      </div>
      <div className="art-spark">
        <Sparkles size={28} strokeWidth={1} />
      </div>
      <span className="art-script">better together</span>
    </div>
  );
}
export function Waveform({
  url,
  color = "#ad624b",
  progress = 0,
}: {
  url?: string;
  color?: string;
  progress?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [samples, setSamples] = useState<Float32Array>();
  useEffect(() => {
    let cancelled = false;
    setSamples(undefined);
    if (url) {
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.arrayBuffer();
        })
        .then((buffer) => {
          const view = new DataView(buffer);
          let pos = 12;
          while (pos + 8 <= buffer.byteLength) {
            const tag = String.fromCharCode(...new Uint8Array(buffer, pos, 4));
            const size = view.getUint32(pos + 4, true);
            if (tag === "data") {
              const count = Math.floor(
                Math.min(size, buffer.byteLength - pos - 8) / 2,
              );
              const pcm = new Float32Array(count);
              for (let i = 0; i < count; i++)
                pcm[i] = view.getInt16(pos + 8 + i * 2, true) / 32768;
              if (!cancelled) setSamples(pcm);
              break;
            }
            pos += 8 + size + (size % 2);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [url]);
  useEffect(() => {
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      const bars = Math.floor(width / 5);
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        if (samples) {
          const start = Math.floor((i / bars) * samples.length),
            end = Math.floor(((i + 1) / bars) * samples.length);
          for (
            let j = start;
            j < end;
            j += Math.max(1, Math.floor((end - start) / 35))
          )
            peak = Math.max(peak, Math.abs(samples[j]));
        }
        const amplitude = samples
          ? Math.max(3, Math.min(peak * 1.8, 1) * (height - 8))
          : 3;
        ctx.fillStyle = samples ? color : "#dbd7ce";
        ctx.globalAlpha =
          progress && i / bars > progress ? 0.3 : samples ? 0.8 : 0.6;
        ctx.beginPath();
        ctx.roundRect(i * 5, (height - amplitude) / 2, 2.5, amplitude, 2);
        ctx.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [samples, color, progress]);
  return (
    <canvas
      ref={ref}
      className="waveform"
      aria-label={url ? "Waveform of the saved take" : "No recording yet"}
    />
  );
}
export function EmptyState({
  kind,
  title,
  children,
}: {
  kind: "gift" | "mic";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        {kind === "gift" ? (
          <Heart size={27} strokeWidth={1.3} />
        ) : (
          <Mic2 size={27} strokeWidth={1.3} />
        )}
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Steps({ stage }: { stage: number }) {
  return (
    <div className="journey-steps">
      {["Find your melody", "Add your voice", "Bring it together"].map(
        (label, i) => (
          <div
            className={`journey-step ${stage === i ? "current" : ""} ${stage > i ? "complete" : ""}`}
            key={label}
          >
            <span>{stage > i ? <Check size={13} /> : `0${i + 1}`}</span>
            {label}
            {i < 2 && <div className="step-line" />}
          </div>
        ),
      )}
    </div>
  );
}
export function HeadphoneNote() {
  return (
    <span className="headphone-note">
      <Headphones size={14} /> Wired headphones make the best harmony.
    </span>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={16} />
    </button>
  );
}
