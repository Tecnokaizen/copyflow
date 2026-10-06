"use client";
import { useRef, useState } from "react";
import { SectionCard } from "@/components/gestcopy/section-card";
import { formatFileSize, formatFileTimestamp } from "@/lib/files/format";
import type { QuoteVersionSummary, QuotePdfMetadata } from "@/lib/quotes/types";

export function QuotePdfDocument({ quoteId, version, onGenerated }: {
  quoteId: string; version: QuoteVersionSummary; onGenerated: (file: QuotePdfMetadata) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  if (version.state === "draft") return null;
  const endpoint = `/api/quotes/${quoteId}/versions/${version.id}/pdf`;
  async function generate() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo generar el PDF. Puedes reintentar.");
      onGenerated(body.file);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo generar el PDF."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <SectionCard title={`Documento comercial v${version.version_number}`} bodyClassName="p-5 sm:p-6">
    <p className="mb-4 text-sm text-muted-foreground">{version.pdf_file_id ? "Documento preparado" : "La versión está bloqueada y lista para generar su documento oficial."}</p>
    {version.pdf_file_id ? <>
      <div className="flex flex-wrap gap-3">
        <a href={endpoint} target="_blank" rel="noopener noreferrer" className="gc-action min-h-11">Vista previa PDF</a>
        <a href={`${endpoint}?download=1`} target="_blank" rel="noopener noreferrer" className="gc-action min-h-11">Descargar PDF</a>
      </div>
      {version.pdf_file ? <p className="mt-3 text-xs text-muted-foreground">v{version.version_number} · {formatFileTimestamp(version.pdf_file.completed_at)} · {formatFileSize(version.pdf_file.size_bytes)}</p> : null}
    </> : <button type="button" className="gc-cta min-h-11" disabled={busy} onClick={() => void generate()}>{busy ? "Generando PDF…" : "Generar PDF"}</button>}
    <div aria-live="polite">{busy ? <p className="mt-3 text-sm text-muted-foreground">Preparando documento…</p> : null}</div>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
  </SectionCard>;
}
