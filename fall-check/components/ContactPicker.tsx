"use client";

import { SAMPLE_CONTACTS } from "@/lib/alerts";

export function ContactPicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (contactName: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2 text-lg font-semibold">
      Demo emergency contact
      <select className="min-h-14 rounded-lg border-2 border-slate-500 bg-white p-3 text-slate-950 disabled:opacity-60"
        value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {SAMPLE_CONTACTS.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  );
}
