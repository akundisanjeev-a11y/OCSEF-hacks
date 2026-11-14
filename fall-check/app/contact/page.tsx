"use client";

import { useState } from "react";
import { ContactPicker } from "@/components/ContactPicker";
import { acknowledgeAlert, SAMPLE_CONTACTS } from "@/lib/alerts";
import { useAlerts } from "@/lib/useAlerts";

export default function ContactPage() {
  const [contactName, setContactName] = useState(SAMPLE_CONTACTS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alerts = useAlerts();
  const addressed = alerts.filter((alert) => alert.contactName === contactName).toReversed();

  async function acknowledge(id: string) {
    setBusy(true);
    setError("");
    try { await acknowledgeAlert(id, contactName); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save acknowledgment."); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 p-6 text-lg">
      <p className="font-bold text-amber-700">LOCAL TEST ONLY · No emergency dispatch</p>
      <h1 className="text-4xl font-bold">Fall Check contact window</h1>
      <p>A consenting teammate plays the selected contact. Choose the same sample contact as the sender.</p>
      <ContactPicker value={contactName} onChange={setContactName} disabled={busy} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <section aria-label="Addressed test alerts" aria-live="polite" className="grid gap-4">
        {addressed.length === 0 && <p>Waiting for a test alert addressed to {contactName}.</p>}
        {addressed.map((alert) => (
          <article key={alert.id} className="grid gap-3 rounded-xl border-2 border-slate-400 p-5">
            <h2 className="text-2xl font-bold">{alert.reason === "help_requested" ? "Help requested" : "No response"} — test alert</h2>
            <p>To: {alert.contactName}</p>
            <p>Trigger: {alert.trigger}{alert.trigger === "simulation" ? " (simulated event)" : ""}</p>
            <p>Created: {new Date(alert.createdAt).toLocaleString()}</p>
            <p className="break-all text-sm">Alert ID: {alert.id}</p>
            {alert.acknowledgedAt ? (
              <p className="font-bold text-green-700">Acknowledged at {new Date(alert.acknowledgedAt).toLocaleString()}</p>
            ) : (
              <button className="min-h-16 rounded-lg bg-blue-800 p-4 text-xl font-bold text-white disabled:opacity-60"
                disabled={busy} onClick={() => acknowledge(alert.id)}>Acknowledge</button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
