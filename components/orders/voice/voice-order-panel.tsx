"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceRecorder } from "@/components/orders/voice/voice-recorder";
import { VoiceDraftReview } from "@/components/orders/voice/voice-draft-review";
import {
  applyVoiceDraft,
  buildVoiceRevert,
  projectVoicePatch,
  recordVoiceApplication,
  type VoiceAppliedFields,
  type VoiceApplyReportItem,
  type VoiceApplyResult,
  type VoiceFormSnapshot,
  type VoiceTouchedFields,
} from "@/lib/ai/voice-orders/apply-draft";
import { ACCESS_CODES } from "@/lib/tenant/access";
import type { VoiceOrderDraft } from "@/lib/ai/voice-orders/contract";
import type { QuickOrderField } from "@/lib/settings/quick-order-layout";

type VoiceStatus = {
  enabled: boolean;
  reason: string | null;
  limits: { max_clip_seconds: number; max_audio_bytes: number };
};

type VoiceOrderPanelProps = {
  mode: "full" | "quick";
  tenantSlug: string;
  visibleFields: QuickOrderField[];
  formSnapshot: VoiceFormSnapshot;
  touchedFields: VoiceTouchedFields;
  onApplyPatch: (patch: VoiceApplyResult["patch"]) => void;
  /** «Descartar»: previous values of the fields the draft wrote. */
  onRestoreFields: (values: Partial<VoiceFormSnapshot>) => void;
  /** 401 SESSION_EXPIRED from a voice endpoint (the form keeps its draft). */
  onSessionExpired?: (status: number, body: unknown) => void;
};

/** Patch keys written by each report field («Reemplazar» touches one field). */
const REPORT_FIELD_PATCH_KEYS: Record<string, (keyof VoiceApplyResult["patch"])[]> = {
  title: ["title"],
  description: ["description", "descriptionMode"],
  notes: ["notes"],
  service: ["serviceId"],
  store: ["storeId"],
  entry_channel: ["entryChannelId"],
  order_context: ["orderContextId"],
  assigned_team_member: ["assignedTeamMemberId"],
  priority: ["priority"],
  due: ["dueAtIso"],
  client: ["clientId", "openCreateClientName"],
};

const REPORT_FIELD_TOUCHED_KEY: Record<string, keyof VoiceTouchedFields> = {
  title: "title",
  description: "description",
  notes: "notes",
  service: "serviceId",
  store: "storeId",
  entry_channel: "entryChannelId",
  order_context: "orderContextId",
  assigned_team_member: "assignedTeamMemberId",
  priority: "priority",
  due: "dueAt",
  client: "clientId",
};

function newRequestId() {
  return crypto.randomUUID();
}

function isSessionExpired(status: number, payload: unknown) {
  const code =
    payload && typeof payload === "object"
      ? (payload as { code?: unknown }).code
      : null;
  return status === 401 && code === ACCESS_CODES.sessionExpired;
}

export function VoiceOrderPanel({
  mode,
  tenantSlug,
  visibleFields,
  formSnapshot,
  touchedFields,
  onApplyPatch,
  onRestoreFields,
  onSessionExpired,
}: VoiceOrderPanelProps) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "transcribing" | "transcript_ready" | "extracting" | "draft_ready" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [typedFallback, setTypedFallback] = useState(false);
  const [draft, setDraft] = useState<VoiceOrderDraft | null>(null);
  const [report, setReport] = useState<VoiceApplyReportItem[]>([]);
  const [transcriptionRequestId, setTranscriptionRequestId] = useState<string | null>(
    null
  );
  const [applied, setApplied] = useState<VoiceAppliedFields>({});
  const [discardNotice, setDiscardNotice] = useState<string | null>(null);
  // Requests are async: apply against the form as it is when they return.
  const latest = useRef({ formSnapshot, touchedFields });
  useEffect(() => {
    latest.current = { formSnapshot, touchedFields };
  });

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const response = await fetch("/api/ai/voice-orders/status", {
          credentials: "same-origin",
        });
        const payload = await response.json();
        if (!cancelled && response.ok) {
          setStatus(payload as VoiceStatus);
        } else if (!cancelled) {
          setStatus({
            enabled: false,
            reason: "unavailable",
            limits: { max_clip_seconds: 60, max_audio_bytes: 3_000_000 },
          });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            enabled: false,
            reason: "unavailable",
            limits: { max_clip_seconds: 60, max_audio_bytes: 3_000_000 },
          });
        }
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const extractDraft = useCallback(
    async (text: string, source: "audio" | "typed", requestId: string) => {
      setPhase("extracting");
      setError(null);
      setDiscardNotice(null);
      const response = await fetch("/api/ai/voice-orders/drafts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          transcript: text,
          source,
          mode,
          visible_fields: visibleFields,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (isSessionExpired(response.status, payload)) {
          onSessionExpired?.(response.status, payload);
        }
        setError(payload.error ?? "No se pudo interpretar el dictado");
        setPhase("error");
        return;
      }

      const nextDraft = payload as VoiceOrderDraft;
      const { formSnapshot: form, touchedFields: touched } = latest.current;
      const result = applyVoiceDraft(form, nextDraft, {
        mode,
        visibleFields,
        touchedFields: touched,
        tenantSlug,
      });
      setDraft(nextDraft);
      setReport(result.report);
      // Each new draft is undone on its own: earlier drafts were kept.
      setApplied(
        recordVoiceApplication({}, form, projectVoicePatch(form, result.patch))
      );
      onApplyPatch(result.patch);
      setPhase("draft_ready");
    },
    [mode, onApplyPatch, onSessionExpired, tenantSlug, visibleFields]
  );

  const transcribeBlob = useCallback(
    async (blob: Blob, mimeType: string) => {
      setPhase("transcribing");
      setError(null);
      const requestId = newRequestId();
      setTranscriptionRequestId(requestId);
      const body = new FormData();
      body.append("audio", blob, mimeType.includes("mp4") ? "voice.m4a" : "voice.webm");
      body.append("request_id", requestId);
      body.append("client_duration_ms", "0");

      const response = await fetch("/api/ai/voice-orders/transcriptions", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const payload = await response.json();
      if (!response.ok) {
        if (isSessionExpired(response.status, payload)) {
          onSessionExpired?.(response.status, payload);
        }
        setError(payload.error ?? "No se pudo transcribir el audio");
        setPhase("error");
        return;
      }

      const text = String(payload.transcript?.text ?? "");
      setTranscript(text);
      setPhase("transcript_ready");
    },
    [onSessionExpired]
  );

  const visible = useMemo(() => status?.enabled === true, [status]);

  if (!visible) {
    return null;
  }

  return (
    <section className="mb-4 space-y-3 rounded-xl border border-border p-4">
      <div>
        <h2 className="text-base font-semibold">Pedido por voz</h2>
        <p className="text-sm text-muted-foreground">
          El audio se envía a un proveedor de IA para transcribirlo y no se guarda.
          Revisa los datos antes de crear el pedido.
        </p>
      </div>

      <VoiceRecorder
        maxClipSeconds={status?.limits.max_clip_seconds ?? 60}
        disabled={phase === "transcribing" || phase === "extracting"}
        onRecorded={(blob, mimeType) => void transcribeBlob(blob, mimeType)}
      />

      <div className="space-y-2">
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setTypedFallback((value) => !value)}
        >
          Escribir en lugar de dictar
        </button>
        {typedFallback ? (
          <div className="space-y-2">
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Describe el pedido…"
            />
            <button
              type="button"
              className="gc-cta min-h-11 px-4"
              disabled={!transcript.trim() || phase === "extracting"}
              onClick={() =>
                void extractDraft(transcript.trim(), "typed", newRequestId())
              }
            >
              Interpretar texto
            </button>
          </div>
        ) : null}
      </div>

      {phase === "transcript_ready" ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="voice-transcript">
            Transcripción (editable)
          </label>
          <textarea
            id="voice-transcript"
            className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="gc-cta min-h-11 px-4"
              onClick={() =>
                void extractDraft(
                  transcript.trim(),
                  "audio",
                  transcriptionRequestId ?? newRequestId()
                )
              }
            >
              Interpretar
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3 text-sm"
              onClick={() => {
                setTranscript("");
                setPhase("idle");
              }}
            >
              Repetir
            </button>
          </div>
        </div>
      ) : null}

      {(phase === "transcribing" || phase === "extracting") && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase === "transcribing" ? "Transcribiendo…" : "Interpretando…"}
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {discardNotice ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {discardNotice}
        </p>
      ) : null}

      {draft && phase === "draft_ready" ? (
        <VoiceDraftReview
          draft={draft}
          report={report}
          onDiscard={() => {
            const revert = buildVoiceRevert(applied, latest.current.formSnapshot);
            onRestoreFields(revert.restore);
            setDiscardNotice(
              revert.kept.length > 0
                ? "Dictado descartado. Se conservan los campos que cambiaste después."
                : "Dictado descartado. El formulario vuelve a como estaba."
            );
            setApplied({});
            setDraft(null);
            setReport([]);
            setTranscript("");
            setPhase("idle");
          }}
          onReplaceField={(field) => {
            const touchedKey = REPORT_FIELD_TOUCHED_KEY[field];
            const patchKeys = REPORT_FIELD_PATCH_KEYS[field];
            if (!draft || !touchedKey || !patchKeys) return;
            const { formSnapshot: form, touchedFields: touched } = latest.current;
            const result = applyVoiceDraft(form, draft, {
              mode,
              visibleFields,
              touchedFields: { ...touched, [touchedKey]: false },
              tenantSlug,
            });
            // Only this field: re-applying the rest would append the
            // description twice or overwrite fields edited meanwhile.
            const patch: VoiceApplyResult["patch"] = {};
            for (const key of patchKeys) {
              if (result.patch[key] !== undefined) {
                Object.assign(patch, { [key]: result.patch[key] });
              }
            }
            const item = result.report.find((entry) => entry.field === field);
            setReport((current) =>
              item
                ? current.map((entry) => (entry.field === field ? item : entry))
                : current
            );
            setApplied((current) =>
              recordVoiceApplication(current, form, projectVoicePatch(form, patch))
            );
            onApplyPatch(patch);
          }}
        />
      ) : null}

    </section>
  );
}
