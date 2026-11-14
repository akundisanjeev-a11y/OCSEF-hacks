import type { AlertReason } from "@/lib/alerts";

export const CHECK_IN_SECONDS = 15;
type Response = AlertReason | "ok";

type Callbacks = {
  onTick: (seconds: number) => void;
  onFinish: (response: Response) => void;
  onSpeechUnavailable: () => void;
};

// Scoped to this demo until the monitoring and voice owners integrate their flow.
export function startSpokenCheckIn({ onTick, onFinish, onSpeechUnavailable }: Callbacks) {
  const deadline = performance.now() + CHECK_IN_SECONDS * 1000;
  let active = true;
  let lastSecond = CHECK_IN_SECONDS;
  let timer: number;
  let speechAvailable = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  let utterance: SpeechSynthesisUtterance | null = null;

  function speechFailed() {
    if (!active || !speechAvailable) return;
    speechAvailable = false;
    onSpeechUnavailable();
  }

  function say(text: string) {
    if (!speechAvailable || utterance) return;
    try {
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onend = () => { utterance = null; };
      utterance.onerror = speechFailed;
      window.speechSynthesis.speak(utterance);
    } catch {
      speechFailed();
    }
  }

  function stop() {
    active = false;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", update);
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      window.speechSynthesis.cancel();
      utterance = null;
    }
  }

  function finish(response: Response) {
    if (!active) return;
    // Claim the incident before notifying React or writing to browser storage.
    stop();
    onFinish(performance.now() >= deadline ? "no_response" : response);
  }

  function update() {
    if (!active) return;
    window.clearTimeout(timer);
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      finish("no_response");
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    if (seconds !== lastSecond) {
      lastSecond = seconds;
      onTick(seconds);
      // Skip numbers while the prompt is speaking so stale numbers never queue.
      say(String(seconds));
    }
    timer = window.setTimeout(update, remaining - (seconds - 1) * 1000);
  }

  if (!speechAvailable) onSpeechUnavailable();
  say("Are you OK? Fifteen seconds.");
  document.addEventListener("visibilitychange", update);
  update();
  return {
    respond: (response: "ok" | "help_requested") => finish(response),
    dispose: stop,
  };
}
