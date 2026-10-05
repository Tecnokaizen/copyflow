"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function QuoteDialog({ title, description, confirmLabel, busy, error, children, confirmDisabled, onConfirm, onCancel }: {
  children?: ReactNode; confirmDisabled?: boolean;
  title: string; description: string; confirmLabel: string; busy?: boolean; error?: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby="quote-dialog-title" aria-describedby="quote-dialog-description"
    className="w-[calc(100%_-_2rem)] max-h-[calc(100dvh_-_2rem)] overflow-y-auto max-w-lg rounded-lg border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/50"
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="quote-dialog-title" className="gc-section-title">{title}</h2>
    <p id="quote-dialog-description" className="mt-3 text-sm text-muted-foreground">{description}</p>
    {children}
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button autoFocus type="button" className="gc-action min-h-11" disabled={busy} onClick={onCancel}>Cancelar y mantener lo escrito</button>
      <button type="button" className="gc-cta min-h-11" disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? "Cargando…" : confirmLabel}</button>
    </div>
  </dialog>;
}
