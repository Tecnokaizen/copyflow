"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CLIENT_IMPORT_COMMIT_CHUNK,
  CLIENT_IMPORT_FINALIZE_CHUNK,
  ClientImportApiError,
  clientImportApi,
  type ClientImportBatch,
  type ClientImportRowsPage,
  type ClientImportSummaryRow,
} from "@/lib/imports/clients/api";
import { parseFileInBrowser } from "@/lib/imports/clients/browser";
import { ImportFileError, importFileErrorMessage } from "@/lib/imports/clients/errors";
import {
  CLIENT_IMPORT_FIELD_LABELS,
  CLIENT_IMPORT_FIELDS,
  suggestMapping,
  type ClientImportField,
} from "@/lib/imports/clients/headers";
import { CLIENT_IMPORT_STAGE_CHUNK } from "@/lib/imports/clients/limits";
import { mapRows, mappingToRecord, validateMapping, type ClientImportMapping } from "@/lib/imports/clients/mapping";
import { previewRowProblems, ROW_PROBLEM_LABELS } from "@/lib/imports/clients/normalize";
import type { ParsedImportFile } from "@/lib/imports/clients/parse-file";
import {
  CLIENT_IMPORT_PAGE_SIZE,
  type ClientImportPlan,
  type ClientImportRowDecision,
  type ClientImportRowFilter,
  type ClientImportRowOutcome,
  ROW_FILTER_LABELS,
  ROW_OUTCOME_LABELS,
  rowActions,
  rowOutcome,
  rowSituation,
} from "@/lib/imports/clients/review";
import {
  buildClientImportTemplateCsv,
  CLIENT_IMPORT_TEMPLATE_FILE_NAME,
  detectClientImportTemplate,
} from "@/lib/imports/clients/template";

type Step = "file" | "map" | "preview" | "review" | "confirm" | "result";

const STEPS: { id: Step; label: string }[] = [
  { id: "file", label: "Archivo" },
  { id: "map", label: "Columnas" },
  { id: "preview", label: "Vista previa" },
  { id: "review", label: "Revisión" },
  { id: "confirm", label: "Importar" },
  { id: "result", label: "Informe" },
];

const GESTCOPY_TEMPLATE = "Plantilla Gestcopy";

const STATUS_LABELS: Record<ClientImportBatch["status"], string> = {
  uploaded: "Sin revisar",
  validated: "Revisada",
  committing: "Importación a medias",
  committed: "Importada",
  cancelled: "Descartada",
  reverted: "Revertida",
  expired: "Caducada",
};

const ENCODING_LABELS: Record<string, string> = {
  "windows-1252": " · codificación Windows (ANSI)",
  "utf-16le": " · codificación Unicode (UTF-16)",
};

/** Filters offered in the review, in this order; empty ones are hidden. */
const REVIEW_FILTERS: ClientImportRowFilter[] = [
  "attention",
  "possible_duplicate",
  "duplicate_existing",
  "duplicate_in_file",
  "error",
  "valid",
  "excluded",
  "all",
];

function filterCount(batch: ClientImportBatch, filter: ClientImportRowFilter) {
  const { counts } = batch;
  switch (filter) {
    case "attention":
      return counts.total - counts.valid;
    case "excluded":
      return batch.plan?.excluded ?? 0;
    case "all":
      return counts.total;
    case "valid":
    case "error":
    case "duplicate_in_file":
    case "duplicate_existing":
    case "possible_duplicate":
      return counts[filter];
    default:
      return batch.plan?.[filter] ?? 0;
  }
}

/** Keeps the last plan the server sent while a response without one (commit chunks) updates the batch. */
function withPlan(next: ClientImportBatch, previous: ClientImportBatch | null): ClientImportBatch {
  return next.plan === undefined ? { ...next, plan: previous?.plan } : next;
}

/** Rows still missing from a batch whose file was not fully sent (e.g. the page was closed). */
function missingRows(batch: ClientImportBatch) {
  return batch.expected_rows === null ? null : Math.max(batch.expected_rows - batch.counts.total, 0);
}

function statusLabel(batch: ClientImportBatch) {
  if (batch.rows_purged && batch.status === "committing") return "Caducada a medias";
  return STATUS_LABELS[batch.status];
}

function incompleteNotice(batch: ClientImportBatch) {
  const missing = missingRows(batch);
  const detail =
    missing === null
      ? "No consta cuántas filas tenía el archivo."
      : `Faltan ${missing.toLocaleString("es-ES")} de ${batch.expected_rows!.toLocaleString("es-ES")} filas por enviar.`;
  return `${detail} Vuelve a elegir el archivo original («${batch.file_name}»), con las mismas columnas, para completarla.`;
}

function messageFor(error: unknown) {
  if (error instanceof ImportFileError) return importFileErrorMessage(error);
  if (error instanceof ClientImportApiError) return error.message;
  return "No se ha podido completar la operación. Inténtalo de nuevo.";
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warning" | "info" | "urgent" }) {
  return (
    <div className="gc-card p-4">
      <p className="gc-kpi-label">{label}</p>
      <p className={tone ? `gc-kpi-value gc-kpi-value-${tone}` : "gc-kpi-value"}>{value.toLocaleString("es-ES")}</p>
    </div>
  );
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm text-muted-foreground">
        {label}: {done.toLocaleString("es-ES")} de {total.toLocaleString("es-ES")}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

const OUTCOME_BADGES: Record<ClientImportRowOutcome, { variant: BadgeProps["variant"]; className?: string }> = {
  create: { variant: "default" },
  fill_blanks: { variant: "secondary" },
  skip: { variant: "outline" },
  excluded: { variant: "outline", className: "border-dashed" },
  not_importable: { variant: "outline", className: "text-destructive" },
  pending: { variant: "outline" },
};

/** What confirming will do, as computed by the server from every row of the batch. */
function PlanKpis({ plan }: { plan: ClientImportPlan }) {
  const notImportable = plan.error + plan.duplicate_in_file;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi label="Se crearán" value={plan.create} tone="info" />
      <Kpi label="Se completarán" value={plan.fill_blanks} />
      <Kpi label="Se omiten (duplicados)" value={plan.skip} />
      <Kpi label="Excluidas por ti" value={plan.excluded} />
      <Kpi label="No se pueden importar" value={notImportable} tone={notImportable ? "urgent" : undefined} />
    </div>
  );
}

export function ClientImportWizard() {
  const [step, setStep] = useState<Step>("file");
  const [sourceKind, setSourceKind] = useState<"gestcopy" | "other">("other");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<ClientImportMapping>([]);
  const [batch, setBatch] = useState<ClientImportBatch | null>(null);
  const [history, setHistory] = useState<ClientImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [fillConfirmed, setFillConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [rowFilter, setRowFilter] = useState<ClientImportRowFilter>("attention");
  const [rowsPage, setRowsPage] = useState<ClientImportRowsPage | null>(null);
  /** after_row of every page up to the one shown, for «Anterior». */
  const [pageStarts, setPageStarts] = useState<number[]>([0]);

  const sourceSystem = sourceKind === "gestcopy" ? GESTCOPY_TEMPLATE : sourceName.trim();
  const mappingProblems = useMemo(() => validateMapping(mapping), [mapping]);
  const mappedRows = useMemo(() => (parsed ? mapRows(parsed.rows, mapping) : []), [parsed, mapping]);
  const previewProblems = useMemo(
    () => mappedRows.map((row) => ({ row, problems: previewRowProblems(row) })),
    [mappedRows],
  );
  const rowsWithProblems = previewProblems.filter((item) => item.problems.length > 0).length;
  const templateVersion = useMemo(() => (parsed ? detectClientImportTemplate(parsed.headers) : null), [parsed]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await clientImportApi.list());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    clientImportApi
      .list()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => {
        if (active) setHistory([]);
      });
    return () => {
      active = false;
    };
  }, []);

  function setColumnField(index: number, value: string) {
    const next = [...mapping];
    next[index] = (value || null) as ClientImportField | null;
    setMapping(next);
  }

  function reset() {
    setStep("file");
    setFile(null);
    setParsed(null);
    setMapping([]);
    setBatch(null);
    setError(null);
    setNotice(null);
    setProgress(null);
    setFillConfirmed(false);
    setRowsPage(null);
    setRowFilter("attention");
    setPageStarts([0]);
    void loadHistory();
  }

  async function readFile(selected: File, sheet?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await parseFileInBrowser(selected, sheet);
      setFile(selected);
      setParsed(result);
      setMapping(suggestMapping(result.headers));
      setStep("map");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Classifies the batch range by range (each call stays well under the DB timeout).
   * The server reports the first row still unclassified, so no range can be skipped.
   */
  async function finalizeAll(id: string, total: number) {
    let fromRow = 1;
    for (;;) {
      setProgress({ label: "Comprobando duplicados", done: Math.min(fromRow - 1, total), total });
      const result: ClientImportBatch = await clientImportApi.finalize(id, fromRow, CLIENT_IMPORT_FINALIZE_CHUNK);
      if (result.done) return;
      const next = result.next_row ?? null;
      if (next === null || next < fromRow) throw new Error("finalize_stalled");
      fromRow = next;
    }
  }

  async function refreshSummary(id: string) {
    const summary = await clientImportApi.summary(id);
    setBatch(summary);
    return summary;
  }

  /** One page of the review. If the batch changed elsewhere meanwhile, its plan is refreshed too. */
  async function loadRows(id: string, filter: ClientImportRowFilter, starts: number[], knownVersion: number) {
    const page = await clientImportApi.rows(id, filter, starts[starts.length - 1], CLIENT_IMPORT_PAGE_SIZE);
    setRowFilter(filter);
    setPageStarts(starts);
    setRowsPage(page);
    if (page.row_version !== knownVersion) await refreshSummary(id);
    return page;
  }

  /** Reloads the page shown after a change; the previous one if the change emptied it. */
  async function reloadRows(id: string, knownVersion: number) {
    const page = await loadRows(id, rowFilter, pageStarts, knownVersion);
    if (page.rows.length === 0 && pageStarts.length > 1) {
      await loadRows(id, rowFilter, pageStarts.slice(0, -1), knownVersion);
    }
  }

  /** Review of a validated batch: rows that need attention first. */
  async function openReview(summary: ClientImportBatch) {
    setFillConfirmed(summary.duplicate_strategy === "fill_blanks");
    const filter = filterCount(summary, "attention") > 0 ? "attention" : "all";
    await loadRows(summary.id, filter, [0], summary.row_version);
    setStep("review");
  }

  async function browseRows(filter: ClientImportRowFilter, starts: number[]) {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      await loadRows(batch.id, filter, starts, batch.row_version);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendToGestcopy() {
    if (!parsed || !file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const record = mappingToRecord(parsed.headers, mapping);
      if (parsed.sheet) record["@sheet"] = parsed.sheet;
      const current = await clientImportApi.create({
        source_system: sourceSystem,
        file_name: parsed.fileName,
        file_size: parsed.fileSize,
        file_sha256: parsed.fileSha256,
        mapping: record,
        expected_rows: mappedRows.length,
      });
      if (current.reused && current.status === "committed") {
        setNotice("Este archivo ya se importó con estas columnas. Este es su resultado.");
        await refreshSummary(current.id);
        setStep("result");
        return;
      }
      if (current.status === "committing") {
        await refreshSummary(current.id);
        setNotice("Esta importación quedó a medias. Puedes reanudarla.");
        setStep("confirm");
        return;
      }
      if (current.status === "validated") {
        await openReview(await refreshSummary(current.id));
        setNotice("Este archivo ya se había revisado con estas columnas. Continúa desde la revisión.");
        return;
      }
      // A resumed batch that already has every row only needs its classification.
      if (missingRows(current) !== 0) {
        for (let start = 0; start < mappedRows.length; start += CLIENT_IMPORT_STAGE_CHUNK) {
          setProgress({ label: "Enviando filas para validar", done: start, total: mappedRows.length });
          await clientImportApi.stage(current.id, mappedRows.slice(start, start + CLIENT_IMPORT_STAGE_CHUNK));
        }
      }
      await finalizeAll(current.id, mappedRows.length);
      await openReview(await refreshSummary(current.id));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function applyStrategy(strategy: "skip" | "fill_blanks") {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      await clientImportApi.strategy(batch.id, strategy, strategy === "fill_blanks" && fillConfirmed);
      const summary = await refreshSummary(batch.id);
      await reloadRows(batch.id, summary.row_version);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeRow(row: ClientImportSummaryRow, decision: ClientImportRowDecision) {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      // The answer carries the new plan computed from every row.
      const updated = await clientImportApi.decisions(batch.id, [row.row_number], decision);
      setBatch(updated);
      await reloadRows(batch.id, updated.row_version);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!batch) return;
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    // The first chunk carries the version whose plan is on screen: if the batch
    // changed since, the server refuses it and nothing is imported.
    let current = batch;
    try {
      while (current.status !== "committed") {
        const processed = current.counts.created + current.counts.filled + current.counts.skipped + current.counts.failed;
        setProgress({ label: "Importando clientes", done: processed, total: current.counts.total });
        current = withPlan(await clientImportApi.commit(current.id, current.row_version, CLIENT_IMPORT_COMMIT_CHUNK), current);
        setBatch(current);
      }
      await refreshSummary(current.id);
      setStep("result");
    } catch (caught) {
      if (caught instanceof ClientImportApiError && caught.code === "row_version_conflict") {
        await showChangedBatch(current.id);
      } else {
        setError(`${messageFor(caught)} La importación se puede reanudar: lo ya importado no se repite.`);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** The batch changed after its plan was shown (another tab or person): show it again instead of importing it. */
  async function showChangedBatch(id: string) {
    try {
      const summary = await refreshSummary(id);
      if (summary.status === "validated") {
        await openReview(summary);
        setNotice(
          "La revisión ha cambiado desde otra pestaña o por otra persona y no se ha importado nada. Comprueba los totales y vuelve a confirmar.",
        );
      } else if (summary.status === "committed") {
        setStep("result");
      } else {
        setError("Otra pestaña o persona está importando este archivo. Cuando termine, pulsa «Reanudar importación».");
      }
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function runRevert() {
    if (!batch) return;
    setRevertOpen(false);
    setBusy(true);
    setError(null);
    const kept: NonNullable<ClientImportBatch["kept"]> = [];
    try {
      const total = batch.counts.created + batch.counts.filled;
      let remaining = total;
      // At least one call, so a batch with nothing to undo still ends as reverted.
      do {
        setProgress({ label: "Revirtiendo", done: total - remaining, total });
        const reverted = await clientImportApi.revert(batch.id);
        kept.push(...(reverted.kept ?? []));
        const next = reverted.remaining ?? 0;
        if (next > 0 && next >= remaining) throw new Error("revert_stalled");
        remaining = next;
      } while (remaining > 0);
      setBatch({ ...(await clientImportApi.summary(batch.id)), kept });
    } catch (caught) {
      setError(`${messageFor(caught)} Puedes volver a pulsar «Revertir importación»: continúa donde se quedó.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function openFromHistory(item: ClientImportBatch) {
    setBusy(true);
    setError(null);
    try {
      const summary = await refreshSummary(item.id);
      setFillConfirmed(summary.duplicate_strategy === "fill_blanks");
      if (summary.rows_purged) {
        // Its rows are gone: only its summary is left.
        setStep("result");
      } else if (summary.status === "uploaded" && missingRows(summary) !== 0) {
        // Never validate a partial file: the rest of the rows must come from the file itself.
        setBatch(null);
        setSourceKind(summary.source_system === GESTCOPY_TEMPLATE ? "gestcopy" : "other");
        if (summary.source_system !== GESTCOPY_TEMPLATE) setSourceName(summary.source_system);
        setNotice(incompleteNotice(summary));
        setStep("file");
      } else if (summary.status === "uploaded") {
        await finalizeAll(summary.id, summary.counts.total);
        await openReview(await refreshSummary(summary.id));
      } else if (summary.status === "validated") {
        await openReview(summary);
      } else if (summary.status === "committing") {
        setStep("confirm");
      } else {
        setStep("result");
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function discard(item: ClientImportBatch) {
    setBusy(true);
    try {
      await clientImportApi.cancel(item.id);
      await loadHistory();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const plan = batch?.plan ?? null;
  const pageFirst = (pageStarts.length - 1) * CLIENT_IMPORT_PAGE_SIZE + 1;
  const stepIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <div className="space-y-6">
      <ol aria-label="Pasos de la importación" className="flex flex-wrap gap-2">
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            aria-current={item.id === step ? "step" : undefined}
            className={item.id === step ? "gc-chip gc-chip-active" : index < stepIndex ? "gc-chip" : "gc-chip opacity-60"}
          >
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      {progress ? <Progress {...progress} /> : null}

      {step === "file" ? (
        <>
          <SectionCard
            title="1. Elige el archivo"
            description="CSV o Excel (.xlsx) de hasta 5 MB y 10.000 clientes. El archivo se lee en tu navegador: a Gestcopy solo llegan las filas que confirmes."
            bodyClassName="space-y-5 px-5 py-5 sm:px-6"
          >
            <fieldset className="space-y-3">
              <legend className="gc-field-label text-sm">¿De dónde viene el archivo?</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={sourceKind === "other" ? "gc-chip gc-chip-active" : "gc-chip"}
                  aria-pressed={sourceKind === "other"}
                  onClick={() => setSourceKind("other")}
                >
                  Otro programa
                </button>
                <button
                  type="button"
                  className={sourceKind === "gestcopy" ? "gc-chip gc-chip-active" : "gc-chip"}
                  aria-pressed={sourceKind === "gestcopy"}
                  onClick={() => setSourceKind("gestcopy")}
                >
                  Plantilla de Gestcopy
                </button>
              </div>
              {sourceKind === "other" ? (
                <label className="gc-field max-w-md">
                  <span className="gc-field-label">Nombre del programa (CRM, contabilidad, gestión…)</span>
                  <input
                    className="gc-field-control"
                    value={sourceName}
                    maxLength={60}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="Ej. Mi programa anterior"
                  />
                </label>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadText(CLIENT_IMPORT_TEMPLATE_FILE_NAME, buildClientImportTemplateCsv())}
                >
                  Descargar plantilla CSV
                </Button>
              )}
            </fieldset>

            <label className="gc-field">
              <span className="gc-field-label">Archivo</span>
              <input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy || !sourceSystem}
                className="gc-field-control file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) void readFile(selected);
                  event.target.value = "";
                }}
              />
              {!sourceSystem ? <span className="text-xs text-muted-foreground">Indica primero el programa de origen.</span> : null}
            </label>
          </SectionCard>

          {history.length ? (
            <SectionCard title="Importaciones recientes" bodyClassName="overflow-x-auto">
              <table className="gc-table">
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Creados</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td className="max-w-[16rem] truncate" title={item.file_name}>
                        {item.file_name}
                        <span className="block text-xs text-muted-foreground">{item.source_system}</span>
                      </td>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>
                        {statusLabel(item)}
                        {item.status === "uploaded" && missingRows(item) !== 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {missingRows(item) === null
                              ? "Falta el número de filas"
                              : `Faltan ${missingRows(item)!.toLocaleString("es-ES")} filas`}
                          </span>
                        ) : null}
                      </td>
                      <td>{item.counts.created.toLocaleString("es-ES")}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          {item.status === "cancelled" || item.status === "expired" ? null : (
                            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void openFromHistory(item)}>
                              {item.rows_purged ? "Ver resumen" : item.status === "committed" || item.status === "reverted" ? "Ver informe" : "Continuar"}
                            </Button>
                          )}
                          {(item.status === "uploaded" || item.status === "validated") && !item.rows_purged ? (
                            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void discard(item)}>
                              Descartar
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : null}
        </>
      ) : null}

      {step === "map" && parsed ? (
        <SectionCard
          title="2. Relaciona las columnas"
          description={`${parsed.fileName} · ${parsed.rows.length.toLocaleString("es-ES")} filas${ENCODING_LABELS[parsed.encoding ?? ""] ?? ""}. Revisa qué dato de Gestcopy corresponde a cada columna; las que no necesites, déjalas en «No importar».`}
          bodyClassName="space-y-4 px-5 py-5 sm:px-6"
        >
          {parsed.sheetNames.length > 1 ? (
            <label className="gc-field max-w-xs">
              <span className="gc-field-label">Hoja</span>
              <select
                className="gc-field-control"
                value={parsed.sheet ?? ""}
                disabled={busy}
                onChange={(event) => file && void readFile(file, event.target.value)}
              >
                {parsed.sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {templateVersion ? (
            <p role="status" className="rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm">
              Es la plantilla de Gestcopy (versión {templateVersion}): cada columna ya está relacionada con su dato.
            </p>
          ) : null}
          <ul className="space-y-3 sm:hidden">
            {parsed.headers.map((header, index) => (
              <li key={`${index}-${header}`} className="rounded-md border border-border/80 p-3">
                <p className="font-medium">{header}</p>
                <p className="truncate text-sm text-muted-foreground">
                  Ejemplo: {parsed.rows.find((row) => row[index]?.trim())?.[index] ?? "—"}
                </p>
                <select
                  aria-label={`Dato para la columna ${header}`}
                  className="gc-field-control mt-2 w-full"
                  value={mapping[index] ?? ""}
                  onChange={(event) => setColumnField(index, event.target.value)}
                >
                  <option value="">No importar</option>
                  {CLIENT_IMPORT_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {CLIENT_IMPORT_FIELD_LABELS[field]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="gc-table">
              <thead>
                <tr>
                  <th>Columna del archivo</th>
                  <th>Ejemplo</th>
                  <th>Dato en Gestcopy</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header, index) => (
                  <tr key={`${index}-${header}`}>
                    <td className="font-medium">{header}</td>
                    <td className="max-w-[14rem] truncate text-muted-foreground">
                      {parsed.rows.find((row) => row[index]?.trim())?.[index] ?? "—"}
                    </td>
                    <td className="text-right">
                      <select
                        aria-label={`Dato para la columna ${header}`}
                        className="gc-field-control w-full min-w-[11rem]"
                        value={mapping[index] ?? ""}
                        onChange={(event) => setColumnField(index, event.target.value)}
                      >
                        <option value="">No importar</option>
                        {CLIENT_IMPORT_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {CLIENT_IMPORT_FIELD_LABELS[field]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappingProblems.length ? (
            <ul className="space-y-1 text-sm text-destructive">
              {mappingProblems.map((problem) => (
                <li key={problem}>
                  {problem === "name_or_company_required"
                    ? "Relaciona al menos una columna con «Nombre» o «Empresa»."
                    : `«${CLIENT_IMPORT_FIELD_LABELS[problem.split(":")[1] as ClientImportField]}» está en más de una columna.`}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={reset}>
              Cambiar archivo
            </Button>
            <Button type="button" disabled={mappingProblems.length > 0} onClick={() => setStep("preview")}>
              Ver vista previa
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === "preview" && parsed ? (
        <SectionCard
          title="3. Vista previa"
          description="Así se crearán los clientes. Gestcopy vuelve a validar cada fila y busca duplicados en tu cartera en el siguiente paso."
          bodyClassName="space-y-4 px-5 py-5 sm:px-6"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Filas con datos" value={mappedRows.length} />
            <Kpi label="Con algún problema" value={rowsWithProblems} tone={rowsWithProblems ? "warning" : undefined} />
            <Kpi label="Sin problemas" value={mappedRows.length - rowsWithProblems} tone="info" />
          </div>
          <div className="overflow-x-auto">
            <table className="gc-table">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>NIF/CIF</th>
                  <th>Problemas</th>
                </tr>
              </thead>
              <tbody>
                {previewProblems.slice(0, 20).map(({ row, problems }) => (
                  <tr key={row.row_number}>
                    <td>{row.row_number}</td>
                    <td className="max-w-[14rem] truncate">{row.name ?? "—"}</td>
                    <td className="max-w-[14rem] truncate">{row.email ?? "—"}</td>
                    <td>{row.phone ?? "—"}</td>
                    <td>{row.tax_id ?? "—"}</td>
                    <td className="text-right text-xs text-destructive">
                      {problems.map((problem) => ROW_PROBLEM_LABELS[problem] ?? problem).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappedRows.length > 20 ? (
            <p className="text-xs text-muted-foreground">Se muestran las 20 primeras filas.</p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("map")}>
              Volver a las columnas
            </Button>
            <Button type="button" disabled={busy || mappedRows.length === 0} onClick={() => void sendToGestcopy()}>
              {busy ? "Validando…" : "Validar en Gestcopy"}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === "review" && batch ? (
        <SectionCard
          title="4. Revisa las filas"
          description="Nada se guarda en tu cartera hasta que confirmes. Por defecto los duplicados se omiten y no se modifica ningún cliente existente."
          bodyClassName="space-y-5 px-5 py-5 sm:px-6"
        >
          {plan ? <PlanKpis plan={plan} /> : null}

          {batch.counts.duplicate_existing > 0 ? (
            <fieldset className="space-y-3 rounded-md border border-border/80 p-4">
              <legend className="px-1 text-sm font-semibold">Clientes que ya existen ({batch.counts.duplicate_existing})</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className={batch.duplicate_strategy === "skip" ? "gc-chip gc-chip-active" : "gc-chip"}
                  aria-pressed={batch.duplicate_strategy === "skip"}
                  onClick={() => void applyStrategy("skip")}
                >
                  Omitirlos (recomendado)
                </button>
                <button
                  type="button"
                  disabled={busy || !fillConfirmed}
                  className={batch.duplicate_strategy === "fill_blanks" ? "gc-chip gc-chip-active" : "gc-chip"}
                  aria-pressed={batch.duplicate_strategy === "fill_blanks"}
                  onClick={() => void applyStrategy("fill_blanks")}
                >
                  Completar solo sus campos vacíos
                </button>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={fillConfirmed}
                  disabled={busy || batch.duplicate_strategy === "fill_blanks"}
                  onChange={(event) => setFillConfirmed(event.target.checked)}
                />
                <span>
                  Entiendo que se rellenarán los campos vacíos de los clientes existentes con los datos del archivo. Nunca se
                  sobrescribe un dato ya guardado y se puede deshacer revirtiendo la importación.
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Para dejar fuera a un cliente concreto, usa «Excluir» en su fila: se mantiene aunque cambies esta opción.
              </p>
            </fieldset>
          ) : null}

          <div className="space-y-3">
            <div role="group" aria-label="Filtrar filas" className="flex flex-wrap gap-2">
              {REVIEW_FILTERS.filter((filter) => filter === rowFilter || filter === "all" || filterCount(batch, filter) > 0).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    disabled={busy}
                    className={filter === rowFilter ? "gc-chip gc-chip-active" : "gc-chip"}
                    aria-pressed={filter === rowFilter}
                    onClick={() => void browseRows(filter, [0])}
                  >
                    {ROW_FILTER_LABELS[filter]} ({filterCount(batch, filter).toLocaleString("es-ES")})
                  </button>
                ),
              )}
            </div>

            {rowsPage?.rows.length ? (
              <ul aria-label={`Filas: ${ROW_FILTER_LABELS[rowFilter]}`} className="divide-y divide-border/60 rounded-md border border-border/80">
                {rowsPage.rows.map((row) => {
                  const outcome = rowOutcome(row);
                  const contact = [row.email, row.phone, row.tax_id].filter(Boolean).join(" · ");
                  return (
                    <li key={row.row_number} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm">
                          <span className="text-muted-foreground">Fila {row.row_number} · </span>
                          <strong>{row.name ?? row.company_name ?? "Sin nombre"}</strong>
                        </p>
                        {contact ? <p className="truncate text-xs text-muted-foreground">{contact}</p> : null}
                        <p className="text-xs">{rowSituation(row)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                        <Badge variant={OUTCOME_BADGES[outcome].variant} className={OUTCOME_BADGES[outcome].className}>
                          {ROW_OUTCOME_LABELS[outcome]}
                        </Badge>
                        {rowActions(row).map((action) => (
                          <Button
                            key={action.decision}
                            type="button"
                            size="sm"
                            variant={action.decision === "exclude" ? "ghost" : "outline"}
                            disabled={busy}
                            aria-label={`${action.label}: fila ${row.row_number}`}
                            onClick={() => void changeRow(row, action.decision)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : rowsPage ? (
              <p className="text-sm text-muted-foreground">No hay filas con este filtro.</p>
            ) : null}

            {rowsPage && rowsPage.total > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Filas {pageFirst.toLocaleString("es-ES")}–{(pageFirst + rowsPage.rows.length - 1).toLocaleString("es-ES")} de{" "}
                  {rowsPage.total.toLocaleString("es-ES")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || pageStarts.length === 1}
                    onClick={() => void browseRows(rowFilter, pageStarts.slice(0, -1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !rowsPage.has_more || rowsPage.next_after_row === null}
                    onClick={() => rowsPage.next_after_row !== null && void browseRows(rowFilter, [...pageStarts, rowsPage.next_after_row])}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" disabled={busy} onClick={reset}>
              Descartar y empezar de nuevo
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep("confirm")}>
              Continuar
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === "confirm" && batch ? (
        <SectionCard
          title="5. Confirma la importación"
          description="Se importa por tramos. Si se interrumpe, puedes reanudarla desde Importaciones recientes sin duplicar nada."
          bodyClassName="space-y-5 px-5 py-5 sm:px-6"
        >
          {plan ? (
            <>
              <PlanKpis plan={plan} />
              <p className="text-sm text-muted-foreground">
                Totales de las {plan.total.toLocaleString("es-ES")} filas del archivo
                {plan.create_possible
                  ? `, incluidos ${plan.create_possible.toLocaleString("es-ES")} posibles duplicados que has marcado para crear`
                  : ""}
                . Si alguien cambia la revisión antes de confirmar, no se importa nada y vuelves a verla.
              </p>
            </>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Origen: {batch.source_system} · Archivo: {batch.file_name}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" disabled={busy || batch.status === "committing"} onClick={() => setStep("review")}>
              Volver a revisar
            </Button>
            <Button type="button" disabled={busy || !plan} onClick={() => setConfirmOpen(true)}>
              {batch.status === "committing" ? "Reanudar importación" : "Importar clientes"}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {step === "result" && batch ? (
        <SectionCard
          title={batch.status === "reverted" ? "Importación revertida" : "6. Importación completada"}
          description={`${batch.file_name} · ${formatDateTime(batch.committed_at ?? batch.created_at)}`}
          bodyClassName="space-y-5 px-5 py-5 sm:px-6"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Creados" value={batch.counts.created} tone="info" />
            <Kpi label="Completados" value={batch.counts.filled} />
            <Kpi label="Omitidos" value={batch.counts.skipped - batch.counts.excluded} />
            {batch.counts.excluded ? <Kpi label="Excluidas por ti" value={batch.counts.excluded} /> : null}
            <Kpi label="Con error" value={batch.counts.failed} tone={batch.counts.failed ? "urgent" : undefined} />
          </div>
          {batch.status === "reverted" ? (
            <p className="text-sm text-muted-foreground">
              {batch.counts.deactivated.toLocaleString("es-ES")} clientes desactivados y {batch.counts.restored.toLocaleString("es-ES")}{" "}
              restaurados.
              {batch.kept?.length
                ? ` ${batch.kept.length} se mantienen porque ya se usan en pedidos o presupuestos o se editaron después.`
                : ""}
            </p>
          ) : null}
          {batch.rows_purged ? (
            <p className="text-sm text-muted-foreground">El detalle por fila se eliminó al cumplirse 30 días.</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              {!batch.rows_purged ? (
                <Button asChild variant="outline">
                  <a href={clientImportApi.reportUrl(batch.id)}>Descargar informe</a>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/clients">Ver clientes</Link>
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {batch.status === "committed" && !batch.rows_purged ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setRevertOpen(true)}>
                  Revertir importación
                </Button>
              ) : null}
              <Button type="button" onClick={reset}>
                Nueva importación
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {confirmOpen && batch ? (
        <ConfirmDialog
          title={batch.status === "committing" ? "¿Reanudar la importación?" : "¿Importar los clientes?"}
          description={
            plan
              ? `Se crearán ${plan.create.toLocaleString("es-ES")} clientes y se completarán ${plan.fill_blanks.toLocaleString("es-ES")} existentes. Podrás revertirlo después mientras no se usen.`
              : "Se importarán las filas revisadas. Podrás revertirlo después mientras no se usen."
          }
          confirmLabel={batch.status === "committing" ? "Reanudar" : "Importar"}
          busy={busy}
          onConfirm={() => void runCommit()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}

      {revertOpen && batch ? (
        <ConfirmDialog
          title="¿Revertir esta importación?"
          description="Se desactivan los clientes creados que no se hayan usado ni editado, y se restauran los campos completados que sigan igual. No se borra nada."
          confirmLabel="Revertir"
          destructive
          busy={busy}
          onConfirm={() => void runRevert()}
          onCancel={() => setRevertOpen(false)}
        />
      ) : null}
    </div>
  );
}
