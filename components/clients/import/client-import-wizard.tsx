"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import {
  CLIENT_IMPORT_COMMIT_CHUNK,
  CLIENT_IMPORT_FINALIZE_CHUNK,
  ClientImportApiError,
  clientImportApi,
  type ClientImportBatch,
  type ClientImportSummaryRow,
} from "@/lib/imports/clients/api";
import { buildTemplateCsv, parseFileInBrowser, TEMPLATE_FILE_NAME } from "@/lib/imports/clients/browser";
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

type Step = "file" | "map" | "preview" | "review" | "confirm" | "result";

const STEPS: { id: Step; label: string }[] = [
  { id: "file", label: "Archivo" },
  { id: "map", label: "Columnas" },
  { id: "preview", label: "Vista previa" },
  { id: "review", label: "Duplicados" },
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

const MATCH_LABELS: Record<string, string> = {
  email: "email",
  phone: "teléfono",
  tax_id: "NIF/CIF",
  source_record: "código de origen",
  phone_prefix: "teléfono sin prefijo +34",
};

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

  const sourceSystem = sourceKind === "gestcopy" ? GESTCOPY_TEMPLATE : sourceName.trim();
  const mappingProblems = useMemo(() => validateMapping(mapping), [mapping]);
  const mappedRows = useMemo(() => (parsed ? mapRows(parsed.rows, mapping) : []), [parsed, mapping]);
  const previewProblems = useMemo(
    () => mappedRows.map((row) => ({ row, problems: previewRowProblems(row) })),
    [mappedRows],
  );
  const rowsWithProblems = previewProblems.filter((item) => item.problems.length > 0).length;

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

  /** Classifies the batch range by range (each call stays well under the DB timeout). */
  async function finalizeAll(id: string, total: number) {
    let fromRow: number | null = 1;
    while (fromRow !== null) {
      setProgress({ label: "Comprobando duplicados", done: Math.min(fromRow - 1, total), total });
      const result: ClientImportBatch = await clientImportApi.finalize(id, fromRow, CLIENT_IMPORT_FINALIZE_CHUNK);
      fromRow = result.done ? null : (result.next_row ?? null);
    }
  }

  async function refreshSummary(id: string) {
    const summary = await clientImportApi.summary(id);
    setBatch(summary);
    return summary;
  }

  async function sendToGestcopy() {
    if (!parsed || !file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const record = mappingToRecord(parsed.headers, mapping);
      if (parsed.sheet) record["@sheet"] = parsed.sheet;
      let current = await clientImportApi.create({
        source_system: sourceSystem,
        file_name: parsed.fileName,
        file_size: parsed.fileSize,
        file_sha256: parsed.fileSha256,
        mapping: record,
      });
      if (current.reused && current.status === "committed") {
        setNotice("Este archivo ya se importó con estas columnas. Este es su resultado.");
        setBatch(current);
        setStep("result");
        return;
      }
      if (current.status === "committing") {
        await refreshSummary(current.id);
        setNotice("Esta importación quedó a medias. Puedes reanudarla.");
        setStep("confirm");
        return;
      }
      for (let start = 0; start < mappedRows.length; start += CLIENT_IMPORT_STAGE_CHUNK) {
        setProgress({ label: "Enviando filas para validar", done: start, total: mappedRows.length });
        await clientImportApi.stage(current.id, mappedRows.slice(start, start + CLIENT_IMPORT_STAGE_CHUNK));
      }
      await finalizeAll(current.id, mappedRows.length);
      current = await refreshSummary(current.id);
      setFillConfirmed(current.duplicate_strategy === "fill_blanks");
      setStep("review");
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
      await refreshSummary(batch.id);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setDecision(row: ClientImportSummaryRow, decision: "create" | "skip") {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      await clientImportApi.decisions(batch.id, [row.row_number], decision);
      await refreshSummary(batch.id);
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
    let current = batch;
    let conflicts = 0;
    try {
      while (current.status !== "committed") {
        const processed = current.counts.created + current.counts.filled + current.counts.skipped + current.counts.failed;
        setProgress({ label: "Importando clientes", done: processed, total: current.counts.total });
        try {
          current = await clientImportApi.commit(current.id, current.row_version, CLIENT_IMPORT_COMMIT_CHUNK);
          setBatch(current);
        } catch (caught) {
          if (caught instanceof ClientImportApiError && caught.code === "row_version_conflict" && conflicts < 3) {
            conflicts += 1;
            current = await refreshSummary(current.id);
            continue;
          }
          throw caught;
        }
      }
      setBatch(await refreshSummary(current.id));
      setStep("result");
    } catch (caught) {
      setError(`${messageFor(caught)} La importación se puede reanudar: lo ya importado no se repite.`);
    } finally {
      setBusy(false);
      setProgress(null);
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
      if (summary.status === "uploaded") {
        await finalizeAll(summary.id, summary.counts.total);
        await refreshSummary(summary.id);
        setStep("review");
      } else if (summary.status === "validated") {
        setStep("review");
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

  const reviewRows = batch?.rows ?? [];
  const possibleRows = reviewRows.filter((row) => row.classification === "possible_duplicate");
  const existingRows = reviewRows.filter((row) => row.classification === "duplicate_existing");
  const problemRows = reviewRows.filter((row) => row.classification === "error" || row.classification === "duplicate_in_file");
  const possibleToCreate = possibleRows.filter((row) => row.decision === "create").length;
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
                <Button type="button" variant="outline" onClick={() => downloadText(TEMPLATE_FILE_NAME, buildTemplateCsv())}>
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
                      <td>{STATUS_LABELS[item.status]}</td>
                      <td>{item.counts.created.toLocaleString("es-ES")}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          {item.status === "cancelled" || item.status === "expired" ? null : (
                            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void openFromHistory(item)}>
                              {item.status === "committed" || item.status === "reverted" ? "Ver informe" : "Continuar"}
                            </Button>
                          )}
                          {item.status === "uploaded" || item.status === "validated" ? (
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
          title="4. Revisa los duplicados"
          description="Por defecto no se modifica ningún cliente existente: los duplicados se omiten."
          bodyClassName="space-y-5 px-5 py-5 sm:px-6"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Nuevos" value={batch.counts.valid} tone="info" />
            <Kpi label="Ya existen" value={batch.counts.duplicate_existing} />
            <Kpi label="Posibles duplicados" value={batch.counts.possible_duplicate} tone="warning" />
            <Kpi label="Repetidos en el archivo" value={batch.counts.duplicate_in_file} />
            <Kpi label="Con errores" value={batch.counts.error} tone={batch.counts.error ? "urgent" : undefined} />
          </div>

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
              {existingRows.length ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {existingRows.slice(0, 10).map((row) => (
                    <li key={row.row_number}>
                      Fila {row.row_number}: {row.name} → {row.matched_client?.name ?? "cliente existente"} (mismo{" "}
                      {row.match_reasons.map((reason) => MATCH_LABELS[reason] ?? reason).join(", ")})
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
          ) : null}

          {possibleRows.length ? (
            <fieldset className="space-y-3 rounded-md border border-border/80 p-4">
              <legend className="px-1 text-sm font-semibold">Posibles duplicados ({possibleRows.length})</legend>
              <p className="text-sm text-muted-foreground">
                Su teléfono coincide con un cliente existente si se ignora el prefijo +34. Se omiten salvo que marques «Crear igualmente».
              </p>
              <ul className="divide-y divide-border/60">
                {possibleRows.map((row) => (
                  <li key={row.row_number} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm">
                      Fila {row.row_number}: <strong>{row.name}</strong> ({row.phone}) ↔ {row.matched_client?.name ?? "cliente existente"}
                    </span>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={row.decision === "create"}
                        disabled={busy}
                        onChange={(event) => void setDecision(row, event.target.checked ? "create" : "skip")}
                      />
                      Crear igualmente
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {problemRows.length ? (
            <details className="rounded-md border border-border/80 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Filas que no se importarán ({batch.counts.error + batch.counts.duplicate_in_file})
              </summary>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {problemRows.slice(0, 100).map((row) => (
                  <li key={row.row_number}>
                    Fila {row.row_number} · {row.name ?? "sin nombre"}:{" "}
                    {row.classification === "duplicate_in_file"
                      ? `repite la fila ${row.matched_row_number}`
                      : row.errors.map((code) => ROW_PROBLEM_LABELS[code] ?? code).join(", ")}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">El informe final incluye todas las filas.</p>
            </details>
          ) : null}

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Clientes nuevos" value={batch.counts.valid + possibleToCreate} tone="info" />
            <Kpi label="A completar" value={batch.duplicate_strategy === "fill_blanks" ? batch.counts.duplicate_existing : 0} />
            <Kpi
              label="Se omiten"
              value={Math.max(batch.counts.total - batch.counts.valid - possibleToCreate - (batch.duplicate_strategy === "fill_blanks" ? batch.counts.duplicate_existing : 0), 0)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Origen: {batch.source_system} · Archivo: {batch.file_name}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" disabled={busy || batch.status === "committing"} onClick={() => setStep("review")}>
              Volver a revisar
            </Button>
            <Button type="button" disabled={busy} onClick={() => setConfirmOpen(true)}>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Creados" value={batch.counts.created} tone="info" />
            <Kpi label="Completados" value={batch.counts.filled} />
            <Kpi label="Omitidos" value={batch.counts.skipped} />
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
          description={`Se crearán hasta ${(batch.counts.valid + possibleToCreate).toLocaleString("es-ES")} clientes en tu cartera. Podrás revertirlo después mientras no se usen.`}
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
