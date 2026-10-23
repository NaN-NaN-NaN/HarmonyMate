import {
  DEFAULT_HARMONY,
  type Actor,
  type HarmonyOptions,
  type Take,
} from "../shared/types.ts";

type Intent =
  | { type: "list" }
  | { type: "error"; message: string }
  | { type: "generate"; takeId: string; options: HarmonyOptions }
  | { type: "play" | "overdub" | "mix"; takeIds: string[] };
const numerals: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
function number(word: string): number {
  if (/^\d+$/.test(word)) return Number(word);
  if (word.includes("十")) {
    const [tens, ones] = word.split("十");
    return (tens ? numerals[tens] : 1) * 10 + (ones ? numerals[ones] : 0);
  }
  return numerals[word];
}
function references(text: string) {
  const groups = [
    ...text.matchAll(
      /tracks?\s*#?\s*(\d+(?:(?:\s*(?:,|&|and|plus|\+)\s*)#?\d+)*)/gi,
    ),
  ].map((m) => m[1]);
  for (const match of text.matchAll(
    /第?\s*([\d一二兩三四五六七八九十]+(?:\s*(?:、|,|，|和|與|及|跟|\+|&)\s*第?\s*[\d一二兩三四五六七八九十]+)*)\s*(?:號)?(?:音)?軌/g,
  ))
    groups.push(match[1]);
  for (const match of text.matchAll(
    /音軌\s*([\d一二兩三四五六七八九十]+(?:\s*(?:、|,|，|和|與|及|跟|\+|&)\s*[\d一二兩三四五六七八九十]+)*)/g,
  ))
    groups.push(match[1]);
  for (const match of text.matchAll(/#(\d+)/g)) groups.push(match[1]);
  return [
    ...new Set(
      groups.flatMap((group) =>
        [...group.matchAll(/[\d一二兩三四五六七八九十]+/g)].map((m) =>
          number(m[0]),
        ),
      ),
    ),
  ];
}
export function trackIntent(
  text: string,
  catalog: Take[],
  actor: Actor,
  selected: string[] = [],
): Intent | undefined {
  const t = text.trim().toLowerCase();
  const zh = /[\u3400-\u9fff]/.test(t);
  const tracks = catalog.filter(
    (take) => (take.reviewStatus ?? "kept") === "kept",
  );
  if (/有哪些|哪些音軌|what.*tracks|list.*tracks|show.*tracks/.test(t))
    return { type: "list" };
  const overdub =
    /overdub|sing\s+(?:along\s+)?with|record.*with|跟.*(?:唱|錄)|邊聽.*錄|一起合唱/.test(
      t,
    );
  const play = /play|listen|hear|播放|一起聽|合在一起聽/.test(t);
  const mix = /save.*mix|mix.*tracks?|儲存.*混音|保存.*混音|合成.*音軌/.test(t);
  const generate =
    !overdub &&
    !play &&
    !mix &&
    /harmony|harmonies|和聲|三度|五度|六度|[356](?:rd|th|度)/.test(t);
  if (!overdub && !play && !mix && !generate) return;
  const nums = references(t);
  let chosen = nums.map((n) => tracks.find((take) => take.trackNumber === n));
  if (chosen.some((take) => !take))
    return {
      type: "error",
      message: zh
        ? "有指定的音軌不存在。請用清單上的音軌編號。"
        : "A requested track number doesn’t exist. Use the numbers in your track list.",
    };
  const options: HarmonyOptions = {
    direction: /higher|high|upper|高|上方/.test(t) ? "higher" : "lower",
    interval: /sixth|6th|六度|6度/.test(t)
      ? 6
      : /fifth|5th|五度|5度/.test(t)
        ? 5
        : 3,
  };
  if (!generate) {
    if (!nums.length && /all|全部|所有/.test(t))
      chosen = tracks.filter((take) => take.active);
    else if (!nums.length && /selected|these|選取|選中|這些/.test(t))
      chosen = selected.map((id) => tracks.find((take) => take.id === id));
    else {
      const groups: Take[][] = [];
      if (/原唱|original/.test(t))
        groups.push(
          tracks.filter(
            (take) =>
              take.part === "lead" &&
              take.source !== "generated-harmony" &&
              take.active,
          ),
        );
      const specs = [
        ...t.matchAll(
          /(higher|high|upper|lower|low|高|低)\s*(3rd|third|5th|fifth|6th|sixth|三度|五度|六度|[356]度)/g,
        ),
      ];
      for (const spec of specs) {
        const direction = /higher|high|upper|高/.test(spec[1])
          ? "higher"
          : "lower";
        const interval = /6|sixth|六/.test(spec[2])
          ? 6
          : /5|fifth|五/.test(spec[2])
            ? 5
            : 3;
        groups.push(
          tracks.filter(
            (take) =>
              take.source === "generated-harmony" &&
              (take.harmonyOptions ?? DEFAULT_HARMONY).direction ===
                direction &&
              (take.harmonyOptions ?? DEFAULT_HARMONY).interval === interval &&
              take.active,
          ),
        );
      }
      if (!specs.length && /harmony|和聲/.test(t))
        groups.push(
          tracks.filter(
            (take) => take.source === "generated-harmony" && take.active,
          ),
        );
      if (!groups.length && !nums.length) {
        const named = tracks.filter(
          (take) => take.name && t.includes(take.name.toLowerCase()),
        );
        if (named.length) groups.push(named);
      }
      if (groups.some((group) => group.length === 0))
        return {
          type: "error",
          message: zh
            ? "有指定的人聲或和聲尚未存在。請先查看音軌清單或生成該和聲。"
            : "A requested voice or harmony isn’t available yet. Check the track list or generate it first.",
        };
      if (groups.some((group) => group.length > 1))
        return {
          type: "error",
          message: zh
            ? "有多軌符合這個名稱，請指定音軌編號。"
            : "More than one track matches. Please specify its track number.",
        };
      chosen = [
        ...new Map(
          [...chosen, ...groups.flat()].map((take) => [take?.id, take]),
        ).values(),
      ];
    }
  }
  if (generate) {
    if (chosen.length > 1)
      return {
        type: "error",
        message: zh
          ? "請選一軌原始人聲來生成和聲。"
          : "Choose one original voice track as the harmony source.",
      };
    const source =
      chosen[0] ??
      tracks.findLast(
        (take) =>
          take.actor === actor &&
          take.source !== "generated-harmony" &&
          take.active,
      );
    if (!source || source.source === "generated-harmony")
      return {
        type: "error",
        message: zh
          ? "請先留下原始人聲，或指定一軌已留下的人聲。"
          : "Keep an original voice recording first, or name its track number.",
      };
    return { type: "generate", takeId: source.id, options };
  }
  if (!chosen.length || chosen.some((take) => !take)) {
    // Bare listening can still mean the current unconfirmed preview.
    if (
      !nums.length &&
      !/track|音軌|原唱|harmony|和聲|全部|selected|選取/.test(t) &&
      !overdub &&
      !mix
    )
      return;
    return {
      type: "error",
      message: zh
        ? "想使用哪些音軌？例如「播放第 1、3 軌」或「跟第 1 軌一起唱」。"
        : "Which tracks? Try ‘play tracks 1 and 3’ or ‘sing with track 1’.",
    };
  }
  if (chosen.length > 8)
    return {
      type: "error",
      message: zh
        ? "一次最多選 8 軌，請指定要使用的編號。"
        : "Choose up to eight tracks by number.",
    };
  return {
    type: overdub ? "overdub" : mix ? "mix" : "play",
    takeIds: chosen.map((take) => take!.id),
  };
}
