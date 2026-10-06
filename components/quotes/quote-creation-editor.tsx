"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { parseQuoteCreationPayload, type QuoteCreationPayload } from "@/lib/quotes/payload";
import type { ClientSummary } from "@/lib/clients/types";

type PendingCreation = { payload: QuoteCreationPayload; client: ClientSummary | null };
export function QuoteCreationEditor() {
  const router = useRouter();
  const [values, setValues] = useState<EditorValues>(newEditorValues);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [service, setService] = useState(''), [assignee, setAssignee] = useState('');
  const [options, setOptions] = useState<{ services: { id: string; name: string }[]; members: { id: string; name: string }[] }>({ services: [], members: [] });
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCreation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [confirmPrepare, setConfirmPrepare] = useState(false), [dirty, setDirty] = useState(false);
  const edited = useRef(new Set<ClientHeaderField>()), submitting = useRef(false), creationId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    async function initialize() {
      const response = await fetch('/api/context', { cache: 'no-store' });
      const context = await response.json();
      if (!response.ok || !context.tenant?.id || !context.user?.id || !context.features?.quotes) throw new Error('No tienes acceso a presupuestos.');
      const key = `quote-creation:${context.tenant.id}:${context.user.id}`;
      const stored = localStorage.getItem(key);
      let recovered: PendingCreation | null = null;
      if (stored) {
        const entry = JSON.parse(stored) as PendingCreation;
        const parsed = parseQuoteCreationPayload(entry.payload);
        if (!parsed.ok) throw new Error('No se pudo recuperar el guardado pendiente. Conserva esta pestaña y contacta con soporte.');
        recovered = { payload: parsed.data, client: entry.client };
      }
      if (!active) return;
      if (recovered) {
        creationId.current = recovered.payload.creation_id;
        setValues({ header: recovered.payload.header, items: recovered.payload.items.map((item, index) => ({ ...item, key: `recovered-${index}` })) });
        setClient(recovered.client); setService(recovered.payload.service_id ?? ''); setAssignee(recovered.payload.assigned_team_member_id ?? '');
        setPending(recovered); setError('Hay un guardado pendiente de confirmar. Reintenta para recuperar el mismo presupuesto.');
      } else creationId.current = crypto.randomUUID();
      setStorageKey(key);
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
    if (submitting.current || !storageKey || !creationId.current) return;
    if (!pending && editorValidation(values).length) { setError('Revisa los campos indicados antes de guardar.'); return; }
    submitting.current = true; setBusy(true); setError(null); setConfirmPrepare(false);
    let operation = pending;
    try {
      if (!operation) {
        operation = { payload: creationPayload(creationId.current, values, client?.id ?? null, service, assignee, prepare), client };
        // Persist only pending saves, scoped by actor + tenant. Retain ID and request across reloads/tab closure.
        localStorage.setItem(storageKey, JSON.stringify(operation));
        setPending(operation);
      }
      const response = await fetch('/api/quotes/create-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation.payload) });
      const result = await response.json();
      if (!response.ok || result.quote_id !== operation.payload.creation_id) {
        // Validation/business failures are returned before a write or after full rollback.
        // An ambiguous server/network failure must keep the original request frozen.
        if (response.status === 400 || response.status === 422) {
          localStorage.removeItem(storageKey); setPending(null);
          throw new Error(result.error ?? 'Revisa los datos del presupuesto.');
        }
        throw new Error(result.error ?? 'No se pudo confirmar el guardado.');
      }
      // Only remove the receipt after a confirmed server acknowledgement.
      localStorage.removeItem(storageKey); setDirty(false);
      router.push(`/quotes/${result.quote_id}`);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'No se pudo confirmar el guardado.'} Reintenta el mismo guardado; no se creará otro presupuesto.`);
    } finally { submitting.current = false; setBusy(false); }
  }
  const disabled = busy || !!pending || !storageKey;
  return <AppShell innerClassName="max-w-6xl">
    <AppNav />
    <PageHeader title="Nuevo presupuesto" description="Completa el presupuesto y guárdalo. La referencia se asigna al guardar."
      actions={<Link href="/quotes" className="gc-action min-h-11">Volver a presupuestos</Link>} />
    <div className="mb-5"><QuoteStatusBadge name="Borrador" code="draft" /></div>
    {!storageKey && !error ? <LoadingState label="Cargando editor" /> : null}
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {pending ? <div className="mb-5 rounded-lg border p-4">
      <p className="mb-3 text-sm">El contenido se conserva hasta confirmar el guardado. Después podrás seguir editando desde la ficha.</p>
      <button className="gc-cta min-h-11" disabled={busy} onClick={() => void save(pending.payload.prepare)}>{busy ? 'Confirmando…' : 'Reintentar guardado'}</button>
    </div> : null}
    <QuoteDraftForm values={values} dirty={dirty} busy={disabled} errors={dirty ? editorValidation(values) : []} onChange={change}
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
