"use client";

import { useState } from "react";
import { SectionCard } from "@/components/gestcopy/section-card";

export function QuoteInternalNotes({
  quoteId,
  notes,
  rowVersion,
  onSaved,
}: {
  quoteId: string;
  notes: string | null;
  rowVersion: number;
  onSaved: (next: { internal_notes: string | null; row_version: number }) => void;
}) {
  const [value, setValue] = useState(notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/quotes/${quoteId}/internal-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value, expected_row_version: String(rowVersion) }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "No se pudieron guardar las notas internas.");
      }
      const nextNotes = typeof body.internal_notes === "string" ? body.internal_notes : null;
      const nextVersion = typeof body.row_version === "string" ? Number(body.row_version) : rowVersion;
      onSaved({ internal_notes: nextNotes, row_version: nextVersion });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las notas internas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Notas internas"
      description="Solo las ve el equipo. No salen en el PDF ni crean una revisión del presupuesto."
      actions={<span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">Solo el equipo</span>}
    >
      <div className="px-5 py-4 sm:px-6">
        <label className="grid gap-2 text-sm">
          <span className="sr-only">Notas internas</span>
          <textarea
            className="gc-field-control min-h-28"
            value={value}
            maxLength={8000}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        {saved ? <p className="mt-2 text-sm text-muted-foreground">Notas internas guardadas.</p> : null}
        <div className="mt-3 flex justify-end">
          <button type="button" className="gc-action" disabled={busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar notas"}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
