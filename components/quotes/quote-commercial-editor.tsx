"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { QuoteStatusBadge } from "./quote-status-badge";
import { QuoteDraftForm } from "./quote-draft-form";
import { QuoteOperationalForm } from "./quote-operational-form";
import { QuoteConversionDialog } from "./quote-conversion-dialog";
import { QuoteDialog } from "./quote-dialog";
import { QuoteActivity } from "./quote-activity";
import { QuotePdfDocument } from "./quote-pdf-document";
import { QuoteFilesSection } from "./quote-files-section";
import { editorValues, editorValidation, draftPayload, formatQuoteMoney, VERSION_LABELS, type EditorValues } from "@/lib/quotes/editor";
import { formatCivilDate } from "@/lib/gestcopy/date-value";
import type { QuoteCommercialDetail, QuoteVersion, QuoteRecord } from "@/lib/quotes/types";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { commercialStatus, autofillClient, manualClientFields, CLIENT_HEADER_FIELDS, type ClientHeaderField } from "@/lib/quotes/creation";
import { cn } from "@/lib/utils";

class QuoteHttpError extends Error {
  constructor(message: string, public code?: string, public status?: number) { super(message); }
}
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new QuoteHttpError(result.error ?? "No se pudo completar la petición.", result.code, response.status);
  return result as T;
}
function when(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}
export function QuoteCommercialEditor({ quoteId }: { quoteId: string }) {
  const [detail, setDetail] = useState<QuoteCommercialDetail | null>(null);
  const [values, setValues] = useState<EditorValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [transitionConfirm, setTransitionConfirm] = useState<"send" | "accept" | "reject" | null>(null);
  const [convertConfirm,setConvertConfirm] = useState(false);
  const [prepareConfirm, setPrepareConfirm] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const edited = useRef(new Set<ClientHeaderField>());
  const activeQuote = useRef(quoteId);
  const base = `/api/quotes/${quoteId}`;

  function adopt(next: QuoteCommercialDetail) {
    const nextValues = editorValues(next);
    edited.current = manualClientFields(nextValues.header, next.current_version?.client_manual_fields);
    setDetail(next); setValues(nextValues); setDirty(false); setSelected(null);
    setActivityKey((key) => key + 1);
  }
  useEffect(() => {
    let active = true;
    activeQuote.current = quoteId;
    request<QuoteCommercialDetail>(`/api/quotes/${quoteId}`)
      .then((next) => { if (active) { adopt(next); setLoadError(null); } })
      .catch((err) => { if (active) setLoadError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; activeQuote.current = ""; };
  }, [quoteId, reload]);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); }
    function beforeNavigate(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const destination = new URL(anchor.href, location.href);
      if (destination.origin !== location.origin || destination.href === location.href) return;
      if (!window.confirm("Hay cambios sin guardar. ¿Quieres salir del presupuesto?")) {
        event.preventDefault(); event.stopPropagation();
      }
    }
    if (dirty) {
      window.addEventListener("beforeunload", beforeUnload);
      document.addEventListener("click", beforeNavigate, true);
    }
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigate, true);
    };
  }, [dirty]);

  function failure(err: unknown) {
    setPrepareConfirm(false);
    if (err instanceof QuoteHttpError && err.status === 409 && (err.code === "stale_row_version" || !err.code)) setConflict(true);
    else setActionError(err instanceof Error ? err.message : "No se pudo completar la petición.");
  }
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setActionError(null); setMessage(null);
    try { await action(); } catch (err) { failure(err); }
    finally { pending.current = false; setBusy(false); }
  }
  async function loadCurrent() {
    const next = await request<QuoteCommercialDetail>(base);
    if (activeQuote.current === quoteId) adopt(next);
    return next;
  }
  async function saveDraft(): Promise<QuoteVersion> {
    if (!detail || !values) throw new Error("No hay un borrador editable.");
    const invalid = editorValidation(values);
    if (invalid.length) throw new Error(invalid.join(" "));
    const result = await request<{ version: QuoteVersion }>(`${base}/draft`, "PUT", draftPayload(detail, { ...values, header: { ...values.header, client_manual_fields: [...edited.current] } }));
    // Acknowledge the successful write before reloading line amounts. If that read
    // fails, retain local input and the new concurrency token; do not retry the write.
    setDetail((current) => current ? { ...current, current_version: result.version, items: [] } : current);
    setDirty(false);
    try { await loadCurrent(); } catch {
      setActionError("Borrador guardado. No se pudieron refrescar las partidas; vuelve a cargar para ver sus importes.");
    }
    return result.version;
  }
  function save() {
    void perform(async () => { await saveDraft(); setMessage("Borrador guardado"); });
  }
  function prepare() {
    void perform(async () => {
      if (!detail?.current_version || !values) return;
      // Saving explicitly first means preparation never discards local edits.
      const version = dirty ? await saveDraft() : detail.current_version;
      const result = await request<{ quote: QuoteRecord; prepared_version: QuoteVersion }>(`${base}/prepare`, "POST", {
        version_id: version.id, expected_row_version: version.row_version,
      });
      setDetail((current) => current ? { ...current, quote: result.quote, current_version: result.prepared_version } : current);
      setDirty(false); setPrepareConfirm(false);
      try { await loadCurrent(); } catch {
        setActionError("La versión está preparada y bloqueada. No se pudo refrescar la ficha; vuelve a cargarla.");
      }
      setMessage("Presupuesto preparado");
    });
  }
  function transition() {
    void perform(async () => {
      if (!detail?.current_version || !transitionConfirm) return;
      await request(`${base}/${transitionConfirm}`, "POST", {
        version_id: detail.current_version.id, expected_row_version: detail.quote.row_version,
      });
      setTransitionConfirm(null);
      await loadCurrent();
      setMessage("Estado del presupuesto actualizado");
    });
  }
  function createDraft(newVersion: boolean) {
    void perform(async () => {
      await request(`${base}/${newVersion ? "versions" : "draft"}`, "POST");
      // Both created and replayed open the one current draft returned by GET.
      await loadCurrent(); setMessage(newVersion ? "Borrador de revisión abierto" : "Borrador abierto");
    });
  }
  const historical = selected ? detail?.versions.find((version) => version.id === selected) : null;
  const validation = values ? editorValidation(values) : [];
  const version = detail?.current_version;
  const status = detail ? commercialStatus({ ...detail.quote, current_version_state: version?.state ?? detail.quote.current_version_state }) : null;
  const hasRevisions = (detail?.versions.length ?? 0) > 1;
  const canConvert = detail?.quote.status?.code === 'accepted' && !!detail.quote.accepted_version_id && !detail.quote.converted_order_id;
  const conversionHint = !version || version.state === 'draft'
    ? 'Prepara el presupuesto, genera su PDF y registra el envío y la aceptación para convertirlo en pedido.'
    : detail?.quote.status?.code === 'rejected'
      ? 'Este presupuesto está rechazado. Crea una revisión y registra su envío y aceptación para convertirlo en pedido.'
      : detail?.quote.status?.code === 'sent'
        ? 'Registra la aceptación del cliente para convertir este presupuesto en pedido.'
        : version.state === 'prepared' && version.pdf_file_id
          ? 'Marca el presupuesto como enviado y registra la aceptación del cliente para convertirlo en pedido.'
          : 'Genera el PDF y registra el envío y la aceptación para convertir este presupuesto en pedido.';
  return <AppShell innerClassName="max-w-6xl">
    <AppNav />
    {loading ? <LoadingState label="Cargando presupuesto" /> : null}
    {!loading && loadError ? <ErrorState title="No se pudo cargar el presupuesto" description={loadError} onRetry={() => { setLoading(true); setReload((n) => n + 1); }} /> : null}
    {!loading && !loadError && detail && values ? <>
      <PageHeader title={detail.quote.reference} description={detail.quote.title || "Presupuesto"} actions={<>{!version ? <Link href={`/quotes/${detail.quote.id}/print`} target="_blank" rel="noopener noreferrer" className="gc-action min-h-11">Imprimir presupuesto</Link> : null}<button className="gc-action min-h-11" type="button" disabled={busy} onClick={() => {
        if (dirty && !window.confirm("Recargar sustituirá tus cambios sin guardar. ¿Quieres continuar?")) return;
        void perform(async () => { await loadCurrent(); setMessage("Ficha recargada"); });
      }}>Recargar ficha</button><Link href="/quotes" className="gc-action min-h-11">Volver a presupuestos</Link></>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {status ? <QuoteStatusBadge name={status.name} code={status.code} /> : null}
        {version && hasRevisions ? <span className="text-sm text-muted-foreground">Revisión {version.version_number}</span> : null}
        <span className="text-sm">{detail.quote.client?.name ?? "Sin cliente"}</span>
        {detail.quote.converted_order ? <Link className="text-sm text-primary hover:underline" href={`/orders/${detail.quote.converted_order.id}`}>Abrir pedido {detail.quote.converted_order.reference}</Link> : null}
      </div>
      <div aria-live="polite" role="status">{message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}</div>
      {actionError ? <p role="alert" className="mb-4 text-sm text-destructive">{actionError}</p> : null}
      <div className="grid min-w-0 gap-5">
        {!historical ? <SectionCard title="Acciones del presupuesto" bodyClassName="flex flex-wrap items-center gap-3 p-5 sm:p-6">
          {version?.state === "prepared" && version.pdf_file_id && ['draft', 'pending'].includes(detail.quote.status?.code ?? '') ?
            <button className="gc-cta min-h-11" disabled={busy} onClick={() => setTransitionConfirm("send")}>Marcar como enviado</button> : null}
          {detail.quote.status?.code === "sent" && version?.state === "sent" ? <>
            <button className="gc-cta min-h-11" disabled={busy} onClick={() => setTransitionConfirm("accept")}>Marcar aceptado</button>
            <button className="gc-action min-h-11" disabled={busy} onClick={() => setTransitionConfirm("reject")}>Marcar rechazado</button>
          </> : null}
          {!detail.quote.converted_order_id ? <>
            <button className="gc-cta min-h-11" type="button" disabled={busy || !canConvert} aria-describedby={!canConvert ? 'quote-conversion-hint' : undefined} onClick={() => { setActionError(null); setConvertConfirm(true); }}>Convertir en pedido</button>
            {!canConvert ? <p id="quote-conversion-hint" className="basis-full text-sm text-muted-foreground">{conversionHint}</p> : null}
          </> : null}
          {detail.quote.converted_order ? <p className="text-sm">Convertido en pedido {detail.quote.converted_order.reference}</p> : null}
          {detail.quote.accepted_version_id ? <p className="text-sm">Revisión aceptada: {detail.versions.find((v) => v.id === detail.quote.accepted_version_id)?.version_number ?? '—'}</p> : null}
        </SectionCard> : null}
        {hasRevisions ? <SectionCard title="Revisiones" bodyClassName="p-5 sm:p-6">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.versions.map((entry) => <li key={entry.id}>
              <button type="button" disabled={busy} className={cn("w-full rounded-lg border bg-background p-3 text-left text-sm hover:bg-muted", (selected === entry.id || (!selected && entry.id === version?.id)) && "border-primary")}
                onClick={() => setSelected(entry.id === version?.id ? null : entry.id)}>
                <span className="font-semibold">Revisión {entry.version_number}</span> · {VERSION_LABELS[entry.state]}
                <span className="mt-2 block font-medium">{formatQuoteMoney(entry.total, entry.currency)}</span>
                <span className="mt-1 block text-muted-foreground">Creada: {when(entry.created_at)}</span>
                {entry.locked_at ? <span className="block text-muted-foreground">Bloqueada: {when(entry.locked_at)}</span> : null}
                {entry.sent_at ? <span className="block text-muted-foreground">Enviada: {when(entry.sent_at)}</span> : null}
              </button>
            </li>)}
          </ul>
        </SectionCard> : null}
        {historical ? <SectionCard title={`Revisión ${historical.version_number}`} description="Consulta el resumen de esta revisión y su PDF. Los datos preparados se conservan sin cambios." bodyClassName="p-5 sm:p-6">
          <p className="mb-4 text-sm">{VERSION_LABELS[historical.state]} · Emisión {formatCivilDate(historical.issue_date)} · Validez {historical.valid_until ? formatCivilDate(historical.valid_until) : "Sin fecha"}</p>
          <dl className="grid gap-4 sm:grid-cols-3">{([['subtotal', 'Subtotal'], ['tax_total', 'IVA'], ['total', 'Total']] as const).map(([key, label]) => <div key={key}><dt className="gc-fact-label">{label}</dt><dd className="font-semibold">{formatQuoteMoney(historical[key], historical.currency)}</dd></div>)}</dl>
          <button type="button" className="gc-action mt-4 min-h-11" onClick={() => setSelected(null)}>Volver al presupuesto actual</button>
        </SectionCard> : version ? <QuoteDraftForm detail={detail} values={values} dirty={dirty} busy={busy} errors={validation} onChange={(next) => { for (const key of CLIENT_HEADER_FIELDS) if (values.header[key] !== next.header[key]) edited.current.add(key); setValues(next); setDirty(true); setMessage(null); }} onSave={save} onPrepare={() => setPrepareConfirm(true)} /> :
          <SectionCard title="Borrador del presupuesto" description="Continúa con el trabajo registrado para añadir partidas y preparar el presupuesto." bodyClassName="p-5 sm:p-6">
            <div className="mb-4"><RichTextContent value={detail.quote.description} /></div>
            <button className="gc-cta min-h-11" type="button" disabled={busy} onClick={() => createDraft(false)}>Completar presupuesto</button>
          </SectionCard>}
        {(historical || version) ? <QuotePdfDocument key={(historical || version)!.id} quoteId={quoteId} version={(historical || version)!} onGenerated={(file) => {
          const documentVersion = (historical || version)!;
          setDetail((current) => current ? { ...current,
            current_version: current.current_version?.id === documentVersion.id ? { ...current.current_version, pdf_file_id: file.id, pdf_file: file } : current.current_version,
            versions: current.versions.map((v) => v.id === documentVersion.id ? { ...v, pdf_file_id: file.id, pdf_file: file } : v),
          } : current);
          setActivityKey((n) => n + 1); setMessage("Documento PDF preparado");
        }} /> : null}
        {version && version.state !== "draft" && !detail.quote.accepted_version_id && detail.quote.status?.code !== "accepted" && !detail.quote.converted_order_id && !historical ? <button className="gc-cta min-h-11 justify-self-end" type="button" disabled={busy} onClick={() => createDraft(true)}>Crear revisión</button> : null}
        <QuoteOperationalForm key={`${detail.quote.id}-${detail.quote.row_version}`} quote={detail.quote} busy={busy} saveDisabled={dirty} clientLocked={dirty || (!!version && version.state !== "draft")} onSave={(fields, client) => {
          const changedClient = fields.client_id !== (detail.quote.client?.id ?? null);
          if (changedClient && !window.confirm('Se actualizarán los datos del cliente conservando los campos que hayas editado manualmente. ¿Quieres continuar?')) return;
          void perform(async () => {
            if (changedClient && version?.state === 'draft') {
              const next = { ...values, header: { ...autofillClient(values.header, client, edited.current), client_manual_fields: [...edited.current] } };
              await request(`${base}/client-draft`, 'POST', { fields: { operational_only: true, expected_row_version: detail.quote.row_version, ...fields }, draft: draftPayload(detail, next) });
              setValues(next); setDirty(false);
              try { await loadCurrent(); } catch { setActionError('Cliente y borrador guardados. Recarga la ficha para comprobar los datos.'); }
            } else {
              const result = await request<{ quote: QuoteRecord }>(base, "PATCH", { operational_only: true, expected_row_version: detail.quote.row_version, ...fields });
              setDetail((current) => current ? { ...current, quote: result.quote } : current);
            }
            setMessage("Gestión operativa guardada");
          });
        }} />
        <QuoteFilesSection quoteId={quoteId} onChanged={() => setActivityKey((n) => n + 1)} />
        <QuoteActivity quoteId={quoteId} reloadKey={activityKey} />
      </div>
    </> : null}
    {convertConfirm && detail && !conflict ? <QuoteConversionDialog quote={detail.quote} busy={busy} error={actionError} onCancel={() => setConvertConfirm(false)} onConfirm={(fields) => {
      void perform(async () => {
        const result = await request<{order:{id:string;reference:string}}>(`${base}/convert`,"POST",{...fields,expected_row_version:detail.quote.row_version});
        setDetail(current=>current?{...current,quote:{...current.quote,converted_order_id:result.order.id,converted_order:result.order}}:current);
        setConvertConfirm(false);setMessage(`Convertido en pedido ${result.order.reference}`);
        try {await loadCurrent();} catch {setActionError("Pedido creado. Recarga la ficha para actualizar los datos.");}
      });
    }}/> : null}
    {transitionConfirm && !conflict ? <QuoteDialog
      title={transitionConfirm === "send" ? "Marcar como enviado" : transitionConfirm === "accept" ? "Marcar aceptado" : "Marcar rechazado"}
      description={transitionConfirm === "send" ? "Esto no enviará ningún correo. Registra que el presupuesto ya se ha enviado al cliente por un canal externo." : "Se registrará la decisión del cliente sobre la versión enviada actual."}
      confirmLabel="Confirmar" busy={busy} error={actionError} onConfirm={transition} onCancel={() => setTransitionConfirm(null)} /> : null}
    {conflict ? <QuoteDialog title="Este presupuesto ha cambiado desde que lo abriste." description="Puedes recargar la versión actual o cancelar y mantener lo escrito localmente. Recargar sustituirá tus cambios locales." confirmLabel="Recargar versión actual" error={actionError} busy={busy} onCancel={() => setConflict(false)} onConfirm={() => {
      void perform(async () => { await loadCurrent(); setConflict(false); setPrepareConfirm(false); setConvertConfirm(false); setMessage("Versión actual recargada"); });
    }} /> : null}
    {prepareConfirm && !conflict ? <QuoteDialog title="Preparar presupuesto" description="El presupuesto quedará en solo lectura. Se guardarán los cambios pendientes. Para modificarlo después tendrás que crear una revisión." confirmLabel="Preparar presupuesto" busy={busy} onConfirm={prepare} onCancel={() => setPrepareConfirm(false)} /> : null}
  </AppShell>;
}
