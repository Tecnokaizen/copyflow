import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autofillClient, clientHeader, commercialStatus, creationPayload, newEditorValues } from './creation';
import { parseQuoteCreationPayload } from './payload';
import { editorValues } from './editor';
import type { ClientSummary } from '../clients/types';
import type { QuoteCommercialDetail } from './types';
const a: ClientSummary = { id: 'e4400000-0000-4000-8000-000000000021', name: 'Clínica A', contact_name: 'Ana', company_name: 'Clínica A SL', tax_id: 'A123', email: 'ana@example.com', phone: '600111222', customer_type_id: null, customer_type_name: null, notes: null };
const b = { ...a, name: 'Cliente B', contact_name: 'Bea', company_name: null, email: 'bea@example.com', phone: '600333444', tax_id: 'B456' };
describe('quote creation and autofill', () => {
  it('fills the five fields, prefers company and never invents an address', () => {
    const h = autofillClient(newEditorValues().header, a, new Set());
    assert.deepEqual(clientHeader(a), { contact_name: 'Ana', contact_email: 'ana@example.com', contact_phone: '600111222', billing_name: 'Clínica A SL', tax_id: 'A123' });
    assert.equal(h.billing_address, null);
    assert.equal(clientHeader(b).billing_name, 'Cliente B');
  });
  it('protects manual changes including deliberately cleared fields when switching or removing client', () => {
    const h = { ...autofillClient(newEditorValues().header, a, new Set()), contact_name: 'Contacto especial', contact_email: null, billing_address: 'Manual' };
    const next = autofillClient(h, b, new Set(['contact_name', 'contact_email']));
    assert.equal(next.contact_name, 'Contacto especial'); assert.equal(next.contact_email, null);
    assert.equal(next.contact_phone, b.phone); assert.equal(next.billing_name, b.name); assert.equal(next.billing_address, 'Manual');
    assert.equal(autofillClient(next, null, new Set(['contact_name'])).contact_name, 'Contacto especial');
  });
  it('produces one complete request with stable creation identity and no UI keys or computed totals', () => {
    const values = newEditorValues(); values.header.description = '<p>Copias</p>';
    const p = creationPayload(a.id, values, b.id, '', '', false);
    const parsed = parseQuoteCreationPayload(p); assert.equal(parsed.ok, true);
    assert.equal(p.creation_id, a.id); assert.equal('version_id' in p, false);
    assert.equal(parseQuoteCreationPayload({ ...p, prepare: true }).ok, false);
    assert.equal(parseQuoteCreationPayload({ ...p, creation_id: 'invalid' }).ok, false);
    assert.equal(parseQuoteCreationPayload({ ...p, client_id: 'other' }).ok, false);
    assert.equal(parseQuoteCreationPayload({ ...p, header: { ...p.header, currency: 'x' } }).ok, false);
  });
  it('shows one commercial state, independently of legacy pending/draft status', () => {
    const q = { status: { id: 's', name: 'En revisión', code: 'pending', color: null }, current_version_state: 'draft' as const, converted_order_id: null };
    assert.equal(commercialStatus(q).name, 'Borrador');
    assert.equal(commercialStatus({ ...q, current_version_state: 'prepared' }).name, 'Preparado');
    assert.equal(commercialStatus({ ...q, current_version_state: 'sent' }).name, 'Enviado');
    assert.equal(commercialStatus({ ...q, status: { ...q.status, code: 'accepted' } }).name, 'Aceptado');
  });
  it('uses frozen contact data for locked documents and never the current master', () => {
    const detail = { quote: { title: 'Trabajo', description: 'Copias', client: a, contact_name: 'Changed later' },
      current_version: { state: 'prepared', contact_header: { contact_name: 'Original', contact_email: null } }, items: [], versions: [] } as unknown as QuoteCommercialDetail;
    const values = editorValues(detail);
    assert.equal(values.header.contact_name, 'Original'); assert.equal(values.header.contact_email, null);
    const draft = { ...detail, quote: { ...detail.quote, contact_name: null }, current_version: { ...detail.current_version!, state: 'draft' as const, contact_header: undefined } };
    assert.equal(editorValues(draft).header.contact_name, 'Ana');
  });
});
