// Vendor-prefixed Web Speech is optional. Text and buttons always work.
export type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
export function recognitionConstructor():
  (new () => RecognitionLike) | undefined {
  const target = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return target.SpeechRecognition || target.webkitSpeechRecognition;
}
export function say(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = /[\u3400-\u9fff]/.test(text) ? "zh-TW" : "en-US";
  utterance.rate = 0.98;
  window.speechSynthesis.speak(utterance);
}
