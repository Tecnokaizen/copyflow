"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { QuoteClientPicker } from "./quote-client-picker";
import { QuoteDraftForm } from "./quote-draft-form";
import { QuoteDialog } from "./quote-dialog";
import { QuoteStatusBadge } from "./quote-status-badge";
import { editorValidation, type EditorValues } from "@/lib/quotes/editor";
import { autofillClient, CLIENT_HEADER_FIELDS, creationPayload, newEditorValues, type ClientHeaderField } from "@/lib/quotes/creation";
import { operationStorageKey, parsePendingCreation, recoverCreations, acknowledgeCreation, withCreationLock, type PendingCreation, type CreationReceipt } from "@/lib/quotes/recovery";
import { isUuid } from "@/lib/team/payload";
import type { ClientSummary } from "@/lib/clients/types";

export function QuoteCreationEditor() {
  const params = useSearchParams();
  return <QuoteOperationEditor key={params.get('op') ?? 'new'} />;
}
function QuoteOperationEditor() {
  const router = useRouter();
  const [values, setValues] = useState<EditorValues>(newEditorValues);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [service, setService] = useState(''), [assignee, setAssignee] = useState('');
  const [options, setOptions] = useState<{ services: { id: string; name: string }[]; members: { id: string; name: string }[] }>({ services: [], members: [] });
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<CreationReceipt[]>([]);
  const [ready, setReady] = useState(false);
  const scope = useRef<{ tenant: string; actor: string } | null>(null);
  const [pending, setPending] = useState<PendingCreation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [confirmPrepare, setConfirmPrepare] = useState(false), [dirty, setDirty] = useState(false);
  const edited = useRef(new Set<ClientHeaderField>()), submitting = useRef(false), creationId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    async function initialize() {
      const response = await fetch('/api/context', { cache: 'no-store' });
      const context = await response.json();
      if (!active) return;
      if (!response.ok || !context.tenant?.id || !context.user?.id || !context.features?.quotes) throw new Error('No tienes acceso a presupuestos.');
      const url = new URL(window.location.href);
      let operation = url.searchParams.get('op');
      if (operation && !isUuid(operation)) throw new Error('La URL de recuperación no es válida. Vuelve a la lista de presupuestos.');
      if (operation) { operation = operation.toLowerCase(); url.searchParams.set('op', operation); }
      if (!operation) { operation = crypto.randomUUID(); url.searchParams.set('op', operation); window.history.replaceState(null, '', url); }
      else if (window.location.href !== url.href) window.history.replaceState(null, '', url);
      const key = operationStorageKey(context.tenant.id, context.user.id, operation);
      creationId.current = operation;
      scope.current = { tenant: context.tenant.id, actor: context.user.id };
      // A URL can recover an executed operation even if local storage is missing or unavailable.
      const receipts = await recoverCreations(operation);
      if (!active) return;
      setStorageKey(key);
      if (receipts.length) { setRecovery(receipts); return; }
      let stored: string | null = null;
      try { stored = localStorage.getItem(key); } catch { /* Server recovery still works. New saves require a successful durable write. */ }
      const recovered = parsePendingCreation(stored, operation);
      if (recovered) adoptPending(recovered);
      else if (url.searchParams.get('new') !== '1') {
        const unacknowledged = await recoverCreations();
        if (!active) return;
        if (unacknowledged.length) { setRecovery(unacknowledged); return; }
      }
      if (active) setReady(true);
    }
    initialize().catch((err) => { if (active) setError(err.message); });
    Promise.all([fetch('/api/services?active=true&page_size=100'), fetch('/api/team?active=true&page_size=100')])
      .then(async ([s, m]) => {
        if (!s.ok || !m.ok) throw new Error('No se pudieron cargar servicio y responsable. Recarga la página para volver a intentarlo.');
        const [sb, mb] = await Promise.all([s.json(), m.json()]);
        if (active) setOptions({ services: sb.services ?? [], members: mb.members ?? [] });
      }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  function adoptPending(operation: PendingCreation) {
    setValues({ header: operation.payload.header, items: operation.payload.items.map((item, index) => ({ ...item, key: `recovered-${index}` })) });
    setClient(operation.client); setService(operation.payload.service_id ?? ''); setAssignee(operation.payload.assigned_team_member_id ?? '');
    edited.current = new Set(operation.edited ?? operation.payload.header.client_manual_fields ?? CLIENT_HEADER_FIELDS);
    setPending(operation); setError('Hay un guardado pendiente de confirmar. Reintenta para recuperar el mismo presupuesto.');
  }
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue && creationId.current) {
        try { const operation = parsePendingCreation(event.newValue, creationId.current); if (operation) adoptPending(operation); }
        catch (err) { setReady(false); setError(err instanceof Error ? err.message : 'No se pudo recuperar el guardado.'); }
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [storageKey]);
  async function openExisting(receipt: CreationReceipt) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const currentScope = scope.current;
      if (!currentScope) return;
      const key = operationStorageKey(currentScope.tenant, currentScope.actor, receipt.operation_id);
      await withCreationLock(key, async () => {
        await acknowledgeCreation(receipt.operation_id);
        try { localStorage.removeItem(key); } catch { /* ACK and URL remain authoritative. */ }
        setDirty(false); router.push(`/quotes/${receipt.quote_id}`);
      });
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo abrir el presupuesto.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function createAnother() {
    const currentScope = scope.current;
    if (!currentScope || submitting.current || busy) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      // Keep the entire recovery block until every visible receipt is acknowledged.
      // A partial failure is safe to retry because ACK is idempotent.
      for (const receipt of recovery) await acknowledgeCreation(receipt.operation_id);
      const operation = crypto.randomUUID(), url = new URL(window.location.href);
      url.searchParams.set('op', operation); url.searchParams.set('new', '1');
      window.history.replaceState(null, '', url);
      creationId.current = operation;
      setStorageKey(operationStorageKey(currentScope.tenant, currentScope.actor, operation));
      setValues(newEditorValues()); setClient(null); setService(''); setAssignee(''); edited.current.clear();
      setPending(null); setRecovery([]); setReady(true); setDirty(false);
    } catch {
      setError('No se pudieron reconocer todos los presupuestos pendientes. Reintenta antes de crear otro.');
    } finally { submitting.current = false; setBusy(false); }
  }
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const beforeNavigate = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (link instanceof HTMLAnchorElement && !window.confirm('Hay cambios sin guardar. ¿Quieres salir del presupuesto?')) { e.preventDefault(); e.stopPropagation(); }
    };
    if (dirty && !pending) { window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', beforeNavigate, true); }
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeNavigate, true); };
  }, [dirty, pending]);
  function change(next: EditorValues) {
    for (const key of CLIENT_HEADER_FIELDS) if (values.header[key] !== next.header[key]) edited.current.add(key);
    setValues(next); setDirty(true);
  }
  function selectClient(next: ClientSummary | null) {
    setClient(next); setValues((current) => ({ ...current, header: autofillClient(current.header, next, edited.current) })); setDirty(true);
  }
  async function save(prepare: boolean) {
    if (submitting.current || !ready || !storageKey || !creationId.current || recovery.length) return;
    if (!pending && editorValidation(values).length) { setError('Revisa los campos indicados antes de guardar.'); return; }
    submitting.current = true; setBusy(true); setError(null); setConfirmPrepare(false);
    const operationId = creationId.current;
    try {
      await withCreationLock(storageKey, async () => {
        // Recheck server and storage after acquiring the lock: another same-op tab may have finished.
        const existing = await recoverCreations(operationId);
        if (existing.length) {
          await acknowledgeCreation(operationId);
          try { localStorage.removeItem(storageKey); } catch { /* URL recovers an acknowledged receipt too. */ }
          setDirty(false); router.push(`/quotes/${existing[0].quote_id}`); return;
        }
        const stored = parsePendingCreation(localStorage.getItem(storageKey), operationId);
        const operation = stored ?? pending ?? {
          payload: creationPayload(operationId, { ...values, header: { ...values.header, client_manual_fields: [...edited.current] } }, client?.id ?? null, service, assignee, prepare),
          client, edited: [...edited.current],
        };
        localStorage.setItem(storageKey, JSON.stringify(operation));
        setPending(operation);
        const response = await fetch('/api/quotes/create-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation.payload) });
        const result = await response.json();
        if (!response.ok || result.quote_id !== operationId) {
          if (response.status === 400 || response.status === 422) { localStorage.removeItem(storageKey); setPending(null); }
          throw new Error(result.error ?? 'No se pudo confirmar el guardado.');
        }
        // Creation and ACK are separate: losing either response leaves a recoverable server receipt.
        await acknowledgeCreation(operationId);
        try { localStorage.removeItem(storageKey); } catch { /* Never turn a committed operation into a new UUID. */ }
        setDirty(false); router.push(`/quotes/${result.quote_id}`);
      });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'No se pudo confirmar el guardado.'} Reintenta el mismo guardado; no se creará otro presupuesto.`);
    } finally { submitting.current = false; setBusy(false); }
  }
  const disabled = busy || !!pending || !ready || recovery.length > 0;
  return <AppShell innerClassName="max-w-6xl">
    <AppNav />
    <PageHeader title="Nuevo presupuesto" description="Completa el presupuesto y guárdalo. La referencia se asigna al guardar."
      actions={<Link href="/quotes" className="gc-action min-h-11">Volver a presupuestos</Link>} />
    <div className="mb-5"><QuoteStatusBadge name="Borrador" code="draft" /></div>
    {!storageKey && !error ? <LoadingState label="Cargando editor" /> : null}
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {recovery.length ? <div className="mb-5 rounded-lg border p-4" role="region" aria-label="Recuperación de presupuesto">
      <p className="mb-3 font-medium">Hay un presupuesto cuya creación no pudimos confirmar.</p>
      <p className="mb-3 text-sm">Puedes abrir el presupuesto existente o decidir crear otro. Los presupuestos existentes se conservarán.</p>
      <div className="flex flex-wrap gap-3">{recovery.map(receipt => <button key={receipt.operation_id} className="gc-cta min-h-11" disabled={busy} onClick={() => void openExisting(receipt)}>
        Abrir presupuesto existente{recovery.length > 1 ? ` · ${receipt.reference}` : ''}
      </button>)}<button className="gc-action min-h-11" disabled={busy} onClick={() => void createAnother()}>{busy ? 'Confirmando…' : 'Crear otro presupuesto'}</button></div>
    </div> : null}
    {pending && !recovery.length ? <div className="mb-5 rounded-lg border p-4">
      <p className="mb-3 text-sm">El contenido se conserva hasta confirmar el guardado. Después podrás seguir editando desde la ficha.</p>
      <button className="gc-cta min-h-11" disabled={busy} onClick={() => void save(pending.payload.prepare)}>{busy ? 'Confirmando…' : 'Reintentar guardado'}</button>
    </div> : null}
    <QuoteDraftForm values={values} dirty={dirty} busy={busy} blocked={disabled} errors={dirty ? editorValidation(values) : []} onChange={change}
      onSave={() => void save(false)} onPrepare={() => setConfirmPrepare(true)} clientSlot={<div className="mb-5 grid gap-4">
        <div className="gc-field"><span className="gc-field-label">Cliente</span><QuoteClientPicker value={client} onChange={selectClient} disabled={disabled} />
          <p className="text-sm text-muted-foreground">Al cambiar de cliente se conservan los campos que hayas editado. La dirección de facturación se introduce a mano.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {([['Servicio', service, setService, options.services], ['Responsable', assignee, setAssignee, options.members]] as const).map(([label, value, setter, list]) =>
            <label className="gc-field" key={label}><span className="gc-field-label">{label}</span><select className="gc-field-control" disabled={disabled} value={value} onChange={(e) => { setter(e.target.value); setDirty(true); }}>
              <option value="">Sin {label.toLowerCase()}</option>{list.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>)}
        </div>
      </div>} />
    {confirmPrepare ? <QuoteDialog title="Preparar presupuesto" description="Se guardará el presupuesto completo y quedará en solo lectura. Para modificarlo después tendrás que crear una revisión." confirmLabel="Preparar presupuesto" busy={busy} onCancel={() => setConfirmPrepare(false)} onConfirm={() => void save(true)} /> : null}
  </AppShell>;
}
