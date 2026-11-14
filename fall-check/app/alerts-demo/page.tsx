"use client";

import { useState } from "react";
import { ContactPicker } from "@/components/ContactPicker";
import { createTestAlert, SAMPLE_CONTACTS, type AlertReason } from "@/lib/alerts";
import { useAlerts } from "@/lib/useAlerts";

export default function AlertsDemoPage() {
  const [contactName, setContactName] = useState(SAMPLE_CONTACTS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const alerts = useAlerts();
  const sent = alerts.find((alert) => alert.id === sentId);

  async function send(reason: AlertReason) {
    setBusy(true);
    setError("");
    try {
      const alert = await createTestAlert({ id: crypto.randomUUID(), contactName, reason, trigger: "simulation" });
      setSentId(alert.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save test alert.");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 p-6 text-lg">
      <p className="font-bold text-amber-700">LOCAL TEST ONLY · Simulated events</p>
      <h1 className="text-4xl font-bold">Contact delivery sample</h1>
      <p>This isolated page tests your full-stack feature while the monitoring page and 15-second check-in are being built by teammates. Each button sends an immediate sample result.</p>
      <ContactPicker value={contactName} onChange={setContactName} disabled={busy} />
      <a className="font-bold underline" href="/contact" target="_blank" rel="noopener noreferrer">Open contact window</a>
      <button className="min-h-16 rounded-lg bg-red-800 p-4 text-xl font-bold text-white disabled:opacity-60" disabled={busy}
        onClick={() => send("help_requested")}>Send sample “Help requested”</button>
      <button className="min-h-16 rounded-lg bg-blue-800 p-4 text-xl font-bold text-white disabled:opacity-60" disabled={busy}
        onClick={() => send("no_response")}>Send sample “No response” (immediate)</button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div role="status" className="rounded-xl border-2 border-slate-400 p-5">
        {sent ? <><p>Test alert sent to {sent.contactName}.</p><p>{sent.acknowledgedAt ? "Contact acknowledged this alert." : "Waiting for contact acknowledgment."}</p><p className="break-all text-sm">Alert ID: {sent.id}</p></> : "No sample sent from this page yet."}
      </div>
    </main>
  );
}
