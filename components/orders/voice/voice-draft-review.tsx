"use client";

import type { VoiceOrderDraft } from "@/lib/ai/voice-orders/contract";
import type { VoiceApplyReportItem } from "@/lib/ai/voice-orders/apply-draft";

/** Form labels for the report's internal field keys. */
const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descripción",
  notes: "Notas internas",
  client: "Cliente",
  service: "Servicio",
  store: "Tienda",
  entry_channel: "Canal de entrada",
  order_context: "Contexto",
  assigned_team_member: "Responsable",
  priority: "Prioridad",
  due: "Entrega prevista",
  tenant: "Organización",
};

type VoiceDraftReviewProps = {
  draft: VoiceOrderDraft;
  report: VoiceApplyReportItem[];
  onDiscard: () => void;
  onReplaceField?: (field: string) => void;
};

export function VoiceDraftReview({
  draft,
  report,
  onDiscard,
  onReplaceField,
}: VoiceDraftReviewProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Revisión del dictado</h3>
          <p className="text-xs text-muted-foreground">
            Revisa los datos antes de pulsar «Crear pedido». La IA no crea el pedido.
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border px-3 text-sm"
          onClick={onDiscard}
        >
          Descartar
        </button>
      </div>

      <div className="rounded-md bg-muted/40 p-2 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Transcripción</p>
        <p className="whitespace-pre-wrap">{draft.transcript.text}</p>
      </div>

      {draft.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
          {draft.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.field ?? ""}-${warning.message}`}>
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {draft.fields.due.status === "partial" ? (
        <p className="text-sm">
          Entrega sugerida: {draft.fields.due.value.civil_date} · falta la hora
        </p>
      ) : null}

      <ul className="space-y-1 text-sm">
        {report.map((item) => (
          <li key={`${item.field}-${item.action}-${item.message}`} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{FIELD_LABELS[item.field] ?? item.field}</span>
            <span className="text-muted-foreground">{item.message}</span>
            {item.action === "skipped_touched" && onReplaceField ? (
              <button
                type="button"
                className="underline"
                aria-label={`Reemplazar ${FIELD_LABELS[item.field] ?? item.field}`}
                onClick={() => onReplaceField(item.field)}
              >
                Reemplazar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
