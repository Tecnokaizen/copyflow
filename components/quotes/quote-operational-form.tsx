"use client";
import { useEffect, useState } from "react";
import { ClientSelector } from "@/components/clients/client-selector";
import { SectionCard } from "@/components/gestcopy/section-card";
import type { ClientSummary } from "@/lib/clients/types";
import type { QuoteRecord } from "@/lib/quotes/types";

export function QuoteOperationalForm({ quote, busy, clientLocked, saveDisabled, onSave }: {
  quote: QuoteRecord; busy: boolean; clientLocked: boolean; saveDisabled: boolean;
  onSave: (fields: { client_id: string | null; service_id: string | null; assigned_team_member_id: string | null }, client: ClientSummary | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ClientSummary | null>(quote.client ? {
    ...quote.client, customer_type_id: null, customer_type_name: null, contact_name: null,
    company_name: null, tax_id: null, email: null, phone: null, notes: null,
  } : null);
  const [service, setService] = useState(quote.service?.id ?? "");
  const [assignee, setAssignee] = useState(quote.assignee?.id ?? "");
  const [options, setOptions] = useState<{ services: Array<{ id: string; name: string }>; members: Array<{ id: string; name: string }> }>({ services: [], members: [] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    Promise.all([fetch("/api/services?active=true&page_size=100"), fetch("/api/team?active=true&page_size=100")])
      .then(async ([s, m]) => {
        if (!s.ok || !m.ok) throw new Error("No se pudieron cargar las opciones operativas.");
        const [sb, mb] = await Promise.all([s.json(), m.json()]);
        if (active) setOptions({ services: sb.services ?? [], members: mb.members ?? [] });
      }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [open]);
  return <SectionCard title="Gestión operativa" description="Cliente asociado, servicio y responsable. Los datos del documento se guardan en el borrador."
    actions={<button type="button" className="gc-action min-h-11" disabled={busy} onClick={() => setOpen(!open)}>{open ? "Cerrar gestión" : "Editar gestión"}</button>} bodyClassName="p-5 sm:p-6">
    {!open ? <p className="text-sm text-muted-foreground">{quote.client?.name ?? "Sin cliente"} · {quote.service?.name ?? "Sin servicio"} · {quote.assignee?.name ?? "Sin responsable"}</p> :
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSave({ client_id: client?.id ?? null, service_id: service || null, assigned_team_member_id: assignee || null }, client); }}>
        <div className="gc-field"><span className="gc-field-label">Cliente asociado</span><ClientSelector value={client} onChange={setClient} disabled={busy || clientLocked} allowNoClient />
          {clientLocked ? <p className="text-sm text-muted-foreground">Guarda los cambios comerciales antes de cambiar el cliente. Una versión bloqueada requiere una nueva versión.</p> : null}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          {([['Servicio', service, setService, options.services, quote.service], ['Responsable', assignee, setAssignee, options.members, quote.assignee]] as const).map(([label, value, setValue, list, current]) => <label className="gc-field" key={label}><span className="gc-field-label">{label}</span><select aria-label={label} className="gc-field-control" disabled={busy} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Sin {label.toLowerCase()}</option>
            {current && !list.some((option) => option.id === current.id) ? <option value={current.id}>{current.name}</option> : null}
            {list.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>)}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <button className="gc-action min-h-11 justify-self-end" disabled={busy || saveDisabled} type="submit">Guardar gestión</button>
      </form>}
  </SectionCard>;
}
