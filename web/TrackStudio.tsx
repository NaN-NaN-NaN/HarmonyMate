import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  AudioLines,
  Gift,
  Headphones,
  Loader2,
  Mic,
  Play,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_HARMONY,
  harmonyLabel,
  type Actor,
  type HarmonyOptions,
  type SongView,
} from "../shared/types.ts";

type Props = {
  song: SongView;
  actor: Actor;
  locked: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onPlay: (ids: string[]) => void;
  onOverdub: (ids: string[]) => void;
  onGenerate: (takeId: string, options: HarmonyOptions) => void;
  onUpdate: (takeId: string, values: Record<string, unknown>) => void;
  onSaveMix: (ids: string[]) => void;
  onPlayMix: (url: string) => void;
  onGift: (mixId: string) => void;
};
const clock = (n: number) => `0:${String(Math.floor(n)).padStart(2, "0")}`;
export default function TrackStudio({
  song,
  actor,
  locked,
  selected,
  onSelect,
  onPlay,
  onOverdub,
  onGenerate,
  onUpdate,
  onSaveMix,
  onPlayMix,
  onGift,
}: Props) {
  const tracks = song.takes.filter(
    (take) => (take.reviewStatus ?? "kept") === "kept",
  );
  const sources = tracks.filter((take) => take.source !== "generated-harmony");
  const [sourceId, setSourceId] = useState("");
  const [options, setOptions] = useState<HarmonyOptions>(DEFAULT_HARMONY);
  useEffect(() => {
    if (!sources.some((t) => t.id === sourceId))
      setSourceId(
        sources.findLast((t) => t.active && t.part === "lead")?.id ??
          sources.findLast((t) => t.active)?.id ??
          sources[0]?.id ??
          "",
      );
  }, [song.id, sources.map((t) => t.id).join(","), sourceId]);
  const pending = song.mixes.filter(
    (mix) => mix.status === "queued" || mix.status === "running",
  );
  const failed = song.mixes.filter(
    (mix) =>
      mix.status === "failed" &&
      !song.mixes.some(
        (next) =>
          next.fingerprint === mix.fingerprint &&
          next.createdAt > mix.createdAt,
      ),
  );
  const savedMixes = song.mixes.filter(
    (mix) => mix.status === "ready" && mix.kind !== "harmony",
  );
  if (!tracks.length) return null;
  return (
    <section className="track-studio" aria-labelledby="tracks-heading">
      <div className="track-section-heading">
        <div>
          <span className="mini-eyebrow">YOUR OWN LITTLE ENSEMBLE</span>
          <h2 id="tracks-heading">Every voice, its own track.</h2>
        </div>
        <span>{tracks.length} tracks</span>
      </div>
      <p className="track-intro">
        Listen solo, pick a few to play together, or sing a new part alongside
        them.
      </p>
      <div className="track-list">
        {tracks.map((take, index) => {
          const number = take.trackNumber ?? index + 1;
          return (
            <div
              className={`individual-track ${selected.includes(take.id) ? "selected" : ""}`}
              key={take.id}
            >
              <div className="track-row-main">
                <input
                  type="checkbox"
                  aria-label={`Select track ${number}`}
                  checked={selected.includes(take.id)}
                  disabled={
                    locked ||
                    (!selected.includes(take.id) && selected.length >= 8)
                  }
                  onChange={() =>
                    onSelect(
                      selected.includes(take.id)
                        ? selected.filter((id) => id !== take.id)
                        : [...selected, take.id],
                    )
                  }
                />
                <span className="track-number">{number}</span>
                <span
                  className={`track-icon ${take.source === "generated-harmony" ? "generated" : ""}`}
                >
                  {take.source === "generated-harmony" ? (
                    <Sparkles size={19} />
                  ) : (
                    <Mic size={19} />
                  )}
                </span>
                <div className="track-description">
                  <strong>{take.name ?? `Track ${number}`}</strong>
                  <small>
                    {take.source === "generated-harmony"
                      ? "GENERATED HARMONY"
                      : take.source === "sample-tone"
                        ? "INSTRUMENTAL TEST SAMPLE"
                        : "HUMAN RECORDING"}
                    {take.parentTakeId &&
                      ` · from #${tracks.find((t) => t.id === take.parentTakeId)?.trackNumber ?? "?"}`}
                    {take.referenceTakeIds?.length
                      ? ` · sang with ${take.referenceTakeIds.map((id) => `#${tracks.find((t) => t.id === id)?.trackNumber ?? "?"}`).join(", ")}`
                      : ""}
                    {!take.active ? " · earlier version" : ""} ·{" "}
                    {clock(take.duration)}
                  </small>
                </div>
                <button
                  className="track-solo"
                  aria-label={`Play track ${number} solo`}
                  disabled={locked}
                  onClick={() => onPlay([take.id])}
                >
                  <Play size={16} />
                  <span>Solo</span>
                </button>
                <a
                  className="track-download"
                  href={take.url}
                  download={`track-${number}.wav`}
                  aria-label={`Download track ${number}`}
                >
                  <ArrowDownToLine size={15} />
                </a>
              </div>
              <details className="track-settings">
                <summary>Track settings</summary>
                <div>
                  <label>
                    Name
                    <input
                      aria-label={`Track ${number} name`}
                      maxLength={80}
                      defaultValue={take.name ?? `Track ${number}`}
                      key={`${take.id}:${take.name}`}
                      disabled={
                        locked || (actor !== song.owner && actor !== take.actor)
                      }
                      onBlur={(e) => {
                        if (
                          e.target.value.trim() &&
                          e.target.value.trim() !== take.name
                        )
                          onUpdate(take.id, { name: e.target.value.trim() });
                      }}
                    />
                  </label>
                  <label>
                    Volume (%)
                    <input
                      type="number"
                      aria-label={`Track ${number} volume`}
                      min="0"
                      max="150"
                      step="5"
                      defaultValue={Math.round(take.gain * 100)}
                      key={`${take.id}:${take.gain}`}
                      disabled={
                        locked || (actor !== song.owner && actor !== take.actor)
                      }
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (
                          e.target.value !== "" &&
                          value >= 0 &&
                          value <= 150 &&
                          value / 100 !== take.gain
                        )
                          onUpdate(take.id, { gain: value / 100 });
                      }}
                    />
                  </label>
                  <label>
                    Timing (ms)
                    <input
                      type="number"
                      aria-label={`Track ${number} timing`}
                      min="-1500"
                      max="1500"
                      step="10"
                      defaultValue={take.offsetMs}
                      key={`${take.id}:${take.offsetMs}`}
                      disabled={
                        locked || (actor !== song.owner && actor !== take.actor)
                      }
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (
                          e.target.value !== "" &&
                          value >= -1500 &&
                          value <= 1500 &&
                          value !== take.offsetMs
                        )
                          onUpdate(take.id, { offsetMs: value });
                      }}
                    />
                  </label>
                </div>
              </details>
            </div>
          );
        })}
      </div>
      <div className="track-selection">
        <span>
          {selected.length
            ? `Selected: ${selected.map((id) => `#${tracks.find((t) => t.id === id)?.trackNumber ?? "?"}`).join(", ")}`
            : "Choose tracks to listen or sing along."}
        </span>
        <button
          disabled={locked || !selected.length}
          onClick={() => onSelect([])}
        >
          Clear
        </button>
      </div>
      <div className="track-actions">
        <button
          className="button primary"
          disabled={locked || !selected.length}
          onClick={() => onPlay(selected)}
        >
          <Play size={16} />
          Play selected together
        </button>
        <button
          className="button secondary"
          disabled={locked || !selected.length}
          onClick={() => onOverdub(selected)}
        >
          <Headphones size={17} />
          Sing with selected tracks
        </button>
        <button
          className="text-button"
          disabled={locked || !selected.length}
          onClick={() => onSaveMix(selected)}
        >
          <AudioLines size={16} />
          Save selected mix
        </button>
      </div>
      <span className="simple-caption">
        Select up to 8 tracks. Wear headphones when singing along so only your
        new voice is recorded.
      </span>
      <details className="harmony-options" open>
        <summary>
          <Sparkles size={16} />
          Add a generated harmony
        </summary>
        <div className="harmony-options-body">
          <label>
            From this recording
            <select
              aria-label="Harmony source track"
              value={sourceId}
              disabled={locked}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {sources.map((take) => (
                <option key={take.id} value={take.id}>
                  #{take.trackNumber} {take.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={locked}>
            <legend>Direction</legend>
            {(["higher", "lower"] as const).map((direction) => (
              <button
                type="button"
                key={direction}
                aria-pressed={options.direction === direction}
                onClick={() => setOptions({ ...options, direction })}
              >
                {direction === "higher" ? "Higher" : "Lower"}
              </button>
            ))}
          </fieldset>
          <fieldset disabled={locked}>
            <legend>Interval</legend>
            {([3, 5, 6] as const).map((interval) => (
              <button
                type="button"
                key={interval}
                aria-pressed={options.interval === interval}
                onClick={() => setOptions({ ...options, interval })}
              >
                {interval === 3 ? "3rd" : interval === 5 ? "5th" : "6th"}
              </button>
            ))}
          </fieldset>
          <button
            className="button secondary"
            disabled={locked || !sourceId}
            onClick={() => onGenerate(sourceId, options)}
          >
            <Sparkles size={16} />
            Add {harmonyLabel(options).toLowerCase()}
          </button>
          <small>
            Thirds and sixths follow the estimated key; fifths use a perfect
            fifth. Each choice adds a separate voice track.
          </small>
        </div>
      </details>
      {pending.map((mix) => (
        <div className="track-job" role="status" key={mix.id}>
          <Loader2 size={16} className="spin" />
          <span>
            {mix.kind === "harmony"
              ? `Making ${harmonyLabel(mix.harmonyOptions).toLowerCase()}`
              : "Saving your selected mix"}
            …
          </span>
        </div>
      ))}
      {failed.map((mix) => (
        <div className="track-job failed" role="alert" key={mix.id}>
          <span>{mix.error}</span>
          {mix.kind === "harmony" && mix.sourceTakeId && (
            <button
              disabled={locked}
              onClick={() =>
                onGenerate(
                  mix.sourceTakeId!,
                  mix.harmonyOptions ?? DEFAULT_HARMONY,
                )
              }
            >
              Retry {harmonyLabel(mix.harmonyOptions).toLowerCase()}
            </button>
          )}
        </div>
      ))}
      {savedMixes.length > 0 && (
        <details className="saved-track-mixes">
          <summary>Saved mixes ({savedMixes.length})</summary>
          {[...savedMixes].reverse().map((mix) => (
            <div key={mix.id}>
              <span>
                Tracks {mix.tracks.map((t) => `#${t.trackNumber}`).join(" + ")}
              </span>
              <button
                disabled={locked}
                onClick={() => mix.url && onPlayMix(mix.url)}
              >
                <Play size={14} />
                Play mix
              </button>
              <a href={mix.url} download="selected-mix.wav">
                <ArrowDownToLine size={14} />
                Download
              </a>
              {song.owner === actor && (
                <button disabled={locked} onClick={() => onGift(mix.id)}>
                  <Gift size={14} />
                  Gift
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
