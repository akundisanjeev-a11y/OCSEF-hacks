"use client";

import { useEffect, useRef, useState } from "react";
import { ContactPicker } from "@/components/ContactPicker";
import { createTestAlert, SAMPLE_CONTACTS } from "@/lib/alerts";
import { useAlerts } from "@/lib/useAlerts";
import { CHECK_IN_SECONDS, startSpokenCheckIn } from "./spokenCheckIn";

type AlertInput = Parameters<typeof createTestAlert>[0];
type DemoState =
  | { stage: "ready" | "canceled" | "sending" }
  | { stage: "checking"; seconds: number }
  | { stage: "sent"; id: string }
  | { stage: "failed"; input: AlertInput; message: string };

const button = "min-h-14 rounded-lg px-5 py-3 text-xl font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-4";

export default function SpokenCheckInDemo() {
  const [contact, setContact] = useState(SAMPLE_CONTACTS[0]);
  const [state, setState] = useState<DemoState>({ stage: "ready" });
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const checkIn = useRef<ReturnType<typeof startSpokenCheckIn> | null>(null);
  const alerts = useAlerts();
  const sent = state.stage === "sent" && alerts.find((alert) => alert.id === state.id);
  const running = state.stage === "checking" || state.stage === "sending";

  useEffect(() => () => { checkIn.current?.dispose(); }, []);

  async function deliver(input: AlertInput) {
    setState({ stage: "sending" });
    try {
      const alert = await createTestAlert(input);
      setState({ stage: "sent", id: alert.id });
    } catch (error) {
      setState({ stage: "failed", input, message: error instanceof Error ? error.message : "Could not save the test alert." });
    }
  }

  function simulateFall() {
    if (checkIn.current || running) return;
    const incident = { id: crypto.randomUUID(), contactName: contact, trigger: "simulation" } as const;
    setState({ stage: "checking", seconds: CHECK_IN_SECONDS });
    setSpeechUnavailable(false);
    checkIn.current = startSpokenCheckIn({
      onTick: (seconds) => setState({ stage: "checking", seconds }),
      onSpeechUnavailable: () => setSpeechUnavailable(true),
      onFinish: (response) => {
        checkIn.current = null;
        if (response === "ok") setState({ stage: "canceled" });
        else void deliver({ ...incident, reason: response });
      },
    });
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 p-6 text-lg">
      <header className="grid gap-2">
        <p className="font-bold text-amber-800 dark:text-amber-300">Local test · Simulated fall</p>
        <h1 className="text-4xl font-bold">Fall check-in demo</h1>
        <p>Open the contact window, choose the same teammate in both windows, then simulate a fall.</p>
      </header>
      <ContactPicker value={contact} onChange={setContact} disabled={running} />
      <a className="w-fit font-bold underline" href={`/contact?contact=${encodeURIComponent(contact)}`} target="_blank" rel="noopener noreferrer">Open contact window</a>

      {state.stage === "checking" ? (
        <section aria-label="Active check-in" className="grid gap-4 rounded-xl border-2 border-slate-400 p-5">
          <h2 role="status" className="text-3xl font-bold">Are you OK?</h2>
          <p role="timer" className="text-2xl tabular-nums">{state.seconds} {state.seconds === 1 ? "second" : "seconds"} remaining</p>
          {speechUnavailable && <p>Spoken countdown unavailable. Use the buttons below.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <button className={`${button} bg-green-800`} onClick={() => checkIn.current?.respond("ok")}>I’m OK</button>
            <button className={`${button} bg-red-800`} onClick={() => checkIn.current?.respond("help_requested")}>I need help</button>
          </div>
        </section>
      ) : (
        <button className={`${button} bg-blue-800 disabled:opacity-60`} disabled={running} onClick={simulateFall}>Simulate possible fall</button>
      )}

      <div role="status" className="grid gap-2">
        {state.stage === "canceled" && <p>Check-in canceled. No test alert sent.</p>}
        {state.stage === "sending" && <p>Sending test alert…</p>}
        {sent && <>
          <p>{sent.reason === "help_requested" ? "Help requested" : "No response"} · Test alert sent to {sent.contactName}.</p>
          <p className="font-bold">{sent.acknowledgedAt ? "Contact acknowledged this alert." : "Waiting for contact acknowledgment."}</p>
        </>}
      </div>
      {state.stage === "failed" && <div role="alert" className="grid gap-2">
        <p>{state.message}</p>
        <button className={`${button} bg-blue-800`} onClick={() => void deliver(state.input)}>Retry test alert</button>
      </div>}
    </main>
  );
}
