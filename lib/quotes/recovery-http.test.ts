import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import ts from 'typescript';
import * as commercial from './commercial';
import * as errors from './errors';
import * as uuid from '../team/payload';
const id = '11111111-1111-4111-8111-111111111111';
function harness(options: { denied?: number; data?: unknown; error?: unknown } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const dependencies: Record<string, unknown> = {
    '@/lib/http/operational-cache': { operationalJson: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
    '@/lib/quotes/guard': { requireQuotesAccess: async () => options.denied ? { ok: false, response: Response.json({}, { status: options.denied }) } :
      { ok: true, context: { tenant: { id: 'resolved-host-tenant' } }, supabase: { rpc: async (name: string, args: unknown) => {
        calls.push({ name, args }); return { data: options.data ?? { ok: true, quote_id: id, receipts: [{ operation_id: id, quote_id: id, reference: 'P-1', created_at: '2026-10-06', acknowledged_at: null, request: 'private', result: 'private' }] }, error: options.error };
      } } } },
    '@/lib/quotes/commercial': commercial, '@/lib/quotes/errors': errors, '@/lib/team/payload': uuid,
  };
  const code = ts.transpileModule(readFileSync(new URL('../../app/api/quotes/creation-recovery/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { GET: (request: unknown) => Promise<Response>; POST: (request: unknown) => Promise<Response> } }, native = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', code)((name: string) => dependencies[name] ?? native(name), mod, mod.exports);
  return { calls, get: (op?: string) => mod.exports.GET({ nextUrl: new URL(`http://tenant.local/api/quotes/creation-recovery${op === undefined ? '' : `?op=${op}`}`) }),
    post: (body: unknown) => mod.exports.POST(new Request('http://tenant.local/api/quotes/creation-recovery', { method: 'POST', body: JSON.stringify(body) })) };
}
describe('creation recovery HTTP authorization and whitelist', () => {
  it('binds both recovery and ACK to the authorized host tenant and returns no private payload', async () => {
    const h = harness(), r = await h.get(id); assert.equal(r.status, 200);
    assert.deepEqual(h.calls[0], { name: 'recover_quote_draft_creations_v1', args: { p_tenant_id: 'resolved-host-tenant', p_creation_id: id } });
    const body = await r.json(); assert.equal('request' in body.receipts[0], false); assert.equal('result' in body.receipts[0], false);
    assert.equal((await h.post({ operation_id: id, tenant_id: 'foreign', actor_id: 'foreign' })).status, 200);
    assert.deepEqual(h.calls[1], { name: 'ack_quote_draft_creation_v1', args: { p_tenant_id: 'resolved-host-tenant', p_creation_id: id } });
  });
  it('fails closed on authorization, invalid identity, cross-tenant absence and uncertain results', async () => {
    for (const denied of [401, 403, 404]) { const h = harness({ denied }); assert.equal((await h.get()).status, denied); assert.equal((await h.post({ operation_id: id })).status, denied); assert.equal(h.calls.length, 0); }
    const h = harness(); assert.equal((await h.get('bad')).status, 400); assert.equal((await h.post({ operation_id: 'bad' })).status, 400); assert.equal(h.calls.length, 0);
    assert.equal((await harness({ data: { ok: false, error: 'not_found' } }).post({ operation_id: id })).status, 404);
    assert.equal((await harness({ error: { code: '08006' } }).get()).status, 500);
    assert.equal((await harness({ data: { ok: true, quote_id: 'wrong' } }).post({ operation_id: id })).status, 500);
  });
});
