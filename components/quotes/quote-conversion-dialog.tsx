"use client";
import { useEffect, useState } from "react";
import { QuoteDialog } from "./quote-dialog";
import type { QuoteRecord } from "@/lib/quotes/types";
import { fromDateTimeLocalValue } from "@/lib/orders/format";

type Option = { id: string; name: string };
export type ConversionFields = { store_id: string | null; service_id: string | null; assigned_team_member_id: string | null; priority: string; due_at: string | null };
async function catalog(url: string, key: string): Promise<Option[]> {
  const items: Option[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}page=${page}&page_size=100`, {cache:'no-store'});
    if (!response.ok) throw new Error("No se pudieron cargar los catálogos de esta organización.");
    const body = await response.json();
    items.push(...(body[key] ?? []));
    if (!Number.isInteger(body.total_pages) || page >= body.total_pages) break;
  }
  return items;
}
export function QuoteConversionDialog({ quote, busy, error, onConfirm, onCancel }: {
  quote: QuoteRecord; busy: boolean; error: string | null; onConfirm: (fields: ConversionFields) => void; onCancel: () => void;
}) {
  const [options,setOptions] = useState<{stores:Option[];services:Option[];members:Option[]}|null>(null);
  const [fields,setFields] = useState({store_id:'',service_id:quote.service?.id ?? '',assigned_team_member_id:quote.assignee?.id ?? '',priority:'normal',due_at:''});
  const [localError,setLocalError] = useState<string|null>(null);
  useEffect(()=>{let active=true;Promise.all([catalog('/api/stores?active=true','stores'),catalog('/api/services?active=true','services'),catalog('/api/team?active=true','members')])
    .then(([stores,services,members])=>{if(active){setOptions({stores,services,members});setFields(current=>({...current,
      service_id:services.some(o=>o.id===current.service_id)?current.service_id:'',
      assigned_team_member_id:members.some(o=>o.id===current.assigned_team_member_id)?current.assigned_team_member_id:'',
    }));}}).catch(err=>{if(active)setLocalError(err.message);});return()=>{active=false;};},[]);
  function confirm() {
    if (!options) return;
    const dueAt = fromDateTimeLocalValue(fields.due_at);
    if (fields.due_at && !dueAt) {setLocalError('La fecha y hora de entrega no son válidas o esa hora no existe por el cambio horario.');return;}
    setLocalError(null);
    onConfirm({store_id:fields.store_id||null,service_id:fields.service_id||null,assigned_team_member_id:fields.assigned_team_member_id||null,
      priority:fields.priority,due_at:dueAt});
  }
  return <QuoteDialog title="Convertir en pedido" description="Confirma los datos operativos. Se creará un único pedido desde la versión aceptada; su PDF seguirá disponible en el presupuesto origen."
    confirmLabel="Confirmar y crear pedido" busy={busy} confirmDisabled={!options} error={error||localError} onConfirm={confirm} onCancel={onCancel}>
    {!options ? <p className="mt-4 text-sm">Cargando opciones…</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {([['store_id','Tienda',options.stores],['service_id','Servicio',options.services],['assigned_team_member_id','Responsable',options.members]] as const).map(([key,label,list])=>
        <label className="gc-field" key={key}><span className="gc-field-label">{label}</span><select aria-label={label} className="gc-field-control" value={fields[key]} disabled={busy} onChange={event=>setFields({...fields,[key]:event.target.value})}>
          <option value="">Sin {label.toLowerCase()}</option>{list.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>)}
      <label className="gc-field"><span className="gc-field-label">Prioridad</span><select aria-label="Prioridad" className="gc-field-control" value={fields.priority} disabled={busy} onChange={event=>setFields({...fields,priority:event.target.value})}>
        <option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option>
      </select></label>
      <label className="gc-field sm:col-span-2"><span className="gc-field-label">Fecha y hora de entrega</span><input aria-label="Fecha y hora de entrega" type="datetime-local" className="gc-field-control" disabled={busy} value={fields.due_at} onChange={event=>setFields({...fields,due_at:event.target.value})}/></label>
    </div>}
  </QuoteDialog>;
}
