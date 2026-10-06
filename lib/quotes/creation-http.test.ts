import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import ts from 'typescript';
import * as commercial from './commercial';
import * as payload from './payload';
import * as errors from './errors';
const ID = '11111111-1111-4111-8111-111111111111';
const version = { id: '22222222-2222-4222-8222-222222222222', quote_id: ID, version_number: 1, state: 'draft',
  description: 'Copias', issue_date: '2026-10-06', currency: 'EUR', prices_include_tax: false,
  subtotal: '100.00', tax_total: '21.00', total: '121.00', tax_breakdown: [], created_at: '2026-10-06T12:00:00Z', row_version: 3,
  client_snapshot: { contact_name: 'Ana', client_id: 'private-id' }, seller_snapshot: { private: true } };
const input = { creation_id: ID, client_id: null, service_id: null, assigned_team_member_id: null, prepare: false,
  header: { title: 'Copias', description: '<p>Trabajo</p>', currency: 'EUR', issue_date: '2026-10-06', prices_include_tax: false },
  items: [{ concept: 'A4', quantity: '1', unit_price: '100', tax_rate: '21', total: '99999' }] };
function harness(options: { denied?: number; result?: unknown; dbError?: unknown } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data: options.result ?? { ok: true, quote_id: ID, version }, error: options.dbError ?? null }; } };
  const deps: Record<string, unknown> = {
    '@/lib/http/operational-cache': { operationalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
    '@/lib/quotes/guard': { requireQuotesAccess: async () => options.denied ? { ok: false, response: Response.json({ error: 'denied' }, { status: options.denied }) } :
      { ok: true, supabase, context: { tenant: { id: 'host-tenant' } } } },
    '@/lib/quotes/payload': payload, '@/lib/quotes/commercial': commercial, '@/lib/quotes/errors': errors,
  };
  const code = ts.transpileModule(readFileSync(new URL('../../app/api/quotes/create-draft/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { POST: (req: Request) => Promise<Response> } }, native = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', code)((name: string) => deps[name] ?? native(name), mod, mod.exports);
  return { calls, invoke: (body: unknown = input, raw = false) => mod.exports.POST(new Request('http://host.local/api/quotes/create-draft', { method: 'POST', body: raw ? String(body) : JSON.stringify(body) })) };
}
describe('commercial creation HTTP boundary', () => {
  it('uses one authenticated RPC bound to the host tenant, ignoring injected tenant/totals', async () => {
    const h = harness(); const res = await h.invoke({ ...input, tenant_id: 'foreign-tenant' }); assert.equal(res.status, 200);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'create_quote_draft_v1');
    assert.equal(h.calls[0].args.p_tenant_id, 'host-tenant'); assert.equal(h.calls[0].args.p_creation_id, ID);
    assert.equal('total' in (h.calls[0].args.p_items as Record<string, unknown>[])[0], false);
    const body = await res.json(); assert.equal(body.quote_id, ID);
    assert.equal('client_snapshot' in body.version, false); assert.equal('seller_snapshot' in body.version, false);
    assert.equal(body.version.contact_header.contact_name, 'Ana'); assert.equal('client_id' in body.version.contact_header, false);
  });
  it('normalizes repeated input identically and returns the same creation acknowledgement', async () => {
    const h = harness(); const first = await (await h.invoke()).json(), second = await (await h.invoke()).json();
    assert.deepEqual(first, second); assert.deepEqual(h.calls[0], h.calls[1]);
  });
  it('blocks unauthorized and invalid requests before any write', async () => {
    for (const denied of [401, 403, 404]) { const h = harness({ denied }); assert.equal((await h.invoke()).status, denied); assert.equal(h.calls.length, 0); }
    for (const body of [{}, { ...input, creation_id: 'bad' }, { ...input, prepare: true, items: [] }, { ...input, items: [{ concept: 'A4', quantity: '0', unit_price: '100' }] }]) {
      const h = harness(); assert.equal((await h.invoke(body)).status, 400); assert.equal(h.calls.length, 0);
    }
    assert.equal((await harness().invoke('{broken', true)).status, 400);
  });
  it('returns explicit conflicts and fails closed on invalid or uncertain database results', async () => {
    assert.equal((await harness({ result: { ok: false, error: 'creation_conflict' } }).invoke()).status, 409);
    assert.equal((await harness({ result: { ok: false, error: 'not_found' } }).invoke()).status, 404);
    assert.equal((await harness({ dbError: { code: '23514' } }).invoke()).status, 422);
    assert.equal((await harness({ dbError: { code: '08006' } }).invoke()).status, 500);
    assert.equal((await harness({ result: { ok: true, quote_id: 'wrong', version } }).invoke()).status, 500);
  });
});
