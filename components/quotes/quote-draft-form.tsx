"use client";
import { SectionCard } from "@/components/gestcopy/section-card";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { DatePicker } from "@/components/gestcopy/date-picker";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { emptyEditorItem, moveEditorItem, formatQuoteMoney, type EditorValues } from "@/lib/quotes/editor";
import type { QuoteCommercialDetail, QuoteDraftHeader } from "@/lib/quotes/types";

const TEXT_FIELDS: Array<[keyof QuoteDraftHeader, string, string?, number?]> = [
  ["title", "Título / trabajo", "text", 500], ["contact_name", "Persona de contacto", "text", 500],
  ["contact_email", "Email", "email", 320], ["contact_phone", "Teléfono", "tel", 100],
  ["billing_name", "Nombre fiscal", "text", 500], ["tax_id", "NIF / CIF", "text", 100],
  ["billing_address", "Dirección de facturación", "text", 5000], ["currency", "Moneda", "text", 3],
];
export function QuoteDraftForm({ detail, values, dirty, busy, errors, onChange, onSave, onPrepare }: {
  detail: QuoteCommercialDetail; values: EditorValues; dirty: boolean; busy: boolean; errors: string[];
  onChange: (values: EditorValues) => void; onSave: () => void; onPrepare: () => void;
}) {
  const readonly = detail.current_version?.state !== "draft";
  const disabled = readonly || busy;
  function header(key: keyof QuoteDraftHeader, value: string | boolean | null) {
    onChange({ ...values, header: { ...values.header, [key]: value } });
  }
  const totals = detail.current_version;
  return <form className="grid min-w-0 gap-5" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <SectionCard title="Cabecera comercial" description={readonly ? (detail.quote.accepted_version_id ? "Versión aceptada y bloqueada. El documento comercial se conserva sin cambios." : "Versión bloqueada. Crea una nueva versión para hacer cambios.") : "Los datos de contacto y facturación se guardan con esta versión."} bodyClassName="p-5 sm:p-6">
      <p className="mb-4 text-sm"><span className="gc-fact-label">Cliente </span>{detail.quote.client?.name ?? "Sin cliente"}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map(([key, label, type, maxLength]) => <label className="gc-field min-w-0" key={key}>
          <span className="gc-field-label">{label}</span>
          {key === "billing_address" ? <textarea className="gc-field-control" rows={2} maxLength={maxLength} disabled={disabled}
            value={values.header.billing_address ?? ""} onChange={(e) => header(key, e.target.value || null)} /> :
            <input className="gc-field-control" type={type} maxLength={maxLength} disabled={disabled}
              value={String(values.header[key] ?? "")}
              onChange={(e) => header(key, key === "currency" ? e.target.value.toUpperCase() : e.target.value || null)} />}

        </label>)}
        {([['issue_date', 'Fecha emisión'], ['valid_until', 'Válido hasta']] as const).map(([key, label]) => <div className="gc-field" key={key}>
          <label htmlFor={`quote-${key}`} className="gc-field-label">{label}</label>
          <DatePicker id={`quote-${key}`} value={values.header[key] ?? ""} disabled={disabled} onChange={(value) => header(key, value || (key === "issue_date" ? "" : null))} />
        </div>)}
      </div>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={values.header.prices_include_tax} disabled={disabled} onChange={(e) => header("prices_include_tax", e.target.checked)} />Precios con IVA incluido
      </label>
      {([['description', 'Descripción del trabajo'], ['terms', 'Términos y condiciones']] as const).map(([key, label]) => <div className="gc-field mt-4" key={key}>
        <span className="gc-field-label">{label}</span>
        {readonly ? <RichTextContent value={values.header[key]} /> : <RichTextEditor ariaLabel={label} value={values.header[key] ?? ""} disabled={busy} onChange={(value) => header(key, value)} />}
      </div>)}
    </SectionCard>
    <SectionCard title="Partidas" description={dirty ? "Cambios sin guardar. Los importes se actualizarán al guardar." : "Importes calculados por el servidor."}
      actions={!readonly ? <button type="button" className="gc-action min-h-11" disabled={busy || values.items.length >= 500} onClick={() => onChange({ ...values, items: [...values.items, emptyEditorItem(crypto.randomUUID())] })}>Añadir línea</button> : undefined}
      bodyClassName="p-3 sm:p-5">
      {values.items.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Todavía no hay partidas. Añade la primera línea.</p> : null}
      <ol className="grid gap-4">
        {values.items.map((item, index) => {
          const authoritative = !dirty ? detail.items.find((saved) => saved.id === item.key) : undefined;
          function change(key: string, value: string) {
            onChange({ ...values, items: values.items.map((line) => line.key === item.key ? { ...line, [key]: value } : line) });
          }
          return <li key={item.key} className="min-w-0 rounded-lg border bg-background p-3 sm:p-4" data-testid="quote-item">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Partida {index + 1}</h3>
              {!readonly ? <div className="flex gap-1">
                <button className="gc-action min-h-11" type="button" aria-label={`Subir partida ${index + 1}`} disabled={busy || index === 0} onClick={() => onChange({ ...values, items: moveEditorItem(values.items, index, -1) })}><ArrowUp size={16} /></button>
                <button className="gc-action min-h-11" type="button" aria-label={`Bajar partida ${index + 1}`} disabled={busy || index === values.items.length - 1} onClick={() => onChange({ ...values, items: moveEditorItem(values.items, index, 1) })}><ArrowDown size={16} /></button>
                <button className="gc-action min-h-11" type="button" aria-label={`Eliminar partida ${index + 1}`} disabled={busy} onClick={() => onChange({ ...values, items: values.items.filter((line) => line.key !== item.key) })}><Trash2 size={16} /></button>
              </div> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="gc-field"><span className="gc-field-label">Concepto</span><input className="gc-field-control" required maxLength={2000} disabled={disabled} value={item.concept} onChange={(e) => change("concept", e.target.value)} /></label>
              <label className="gc-field"><span className="gc-field-label">Descripción</span><textarea className="gc-field-control" maxLength={10000} rows={2} disabled={disabled} value={item.description ?? ""} onChange={(e) => change("description", e.target.value)} /></label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {([['quantity', 'Cantidad', '0.000001', undefined], ['unit', 'Unidad', undefined, undefined], ['unit_price', 'Precio unitario', '0', undefined], ['discount_percent', 'Descuento %', '0', '100'], ['tax_rate', 'IVA %', '0', undefined]] as const).map(([key, label, min, max]) => <label className="gc-field min-w-0" key={key}>
                <span className="gc-field-label">{label}</span><input className="gc-field-control" type={key === 'unit' ? 'text' : 'number'} inputMode={key === 'unit' ? 'text' : 'decimal'} min={min} max={max} step="any" maxLength={key === 'unit' ? 100 : undefined} required={key !== 'unit'} disabled={disabled} value={item[key] ?? ""} onChange={(e) => change(key, e.target.value)} />
              </label>)}
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-sm">
              {([['subtotal', 'Subtotal'], ['tax_amount', 'IVA'], ['total', 'Total']] as const).map(([key, label]) => <div key={key}><dt className="gc-fact-label">{label}</dt><dd className="mt-1 break-words font-medium">{formatQuoteMoney(authoritative?.[key], totals?.currency)}</dd></div>)}
            </dl>
          </li>;
        })}
      </ol>
    </SectionCard>
    <SectionCard title="Totales" description={dirty ? "Últimos importes guardados. Guarda para actualizar los totales." : "Importes autoritativos del presupuesto guardado."} bodyClassName="p-5 sm:p-6">
      <dl className="grid gap-4 sm:grid-cols-3" data-testid="quote-totals">
        {([['subtotal', 'Subtotal'], ['tax_total', 'IVA'], ['total', 'Total']] as const).map(([key, label]) => <div key={key}><dt className="gc-fact-label">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{formatQuoteMoney(totals?.[key], totals?.currency)}</dd></div>)}
      </dl>
    </SectionCard>
    {errors.length > 0 ? <div role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive"><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {!readonly ? <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <button type="submit" className="gc-cta min-h-11" disabled={busy}>{busy ? "Guardando…" : "Guardar borrador"}</button>
      <button type="button" className="gc-action min-h-11" disabled={busy || values.items.length === 0 || errors.length > 0} onClick={onPrepare}>Preparar presupuesto</button>
    </div> : null}
  </form>;
}
