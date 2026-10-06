import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { operationStorageKey, parsePendingCreation } from './recovery';
import { creationPayload, manualClientFields, autofillClient, newEditorValues } from './creation';
const id = '11111111-1111-4111-8111-111111111111';
describe('operation recovery and manual field provenance', () => {
  it('isolates operation, actor and tenant and rejects another operation payload', () => {
    const key = operationStorageKey('tenant', 'actor', id);
    assert.notEqual(key, operationStorageKey('tenant', 'actor', 'other'));
    assert.notEqual(key, operationStorageKey('other', 'actor', id));
    assert.notEqual(key, operationStorageKey('tenant', 'other', id));
    const values = newEditorValues(); values.header.description = 'Copias';
    const raw = JSON.stringify({ payload: creationPayload(id, values, null, '', '', false), client: null, edited: ['contact_email'] });
    assert.deepEqual(parsePendingCreation(raw, id)?.edited, ['contact_email']);
    assert.throws(() => parsePendingCreation(raw, 'other'));
  });
  it('retains manual provenance including deliberate blank and equal-to-master values after reload', () => {
    const header = { ...newEditorValues().header, contact_name: 'Manual', contact_email: null };
    const fields = manualClientFields(header, ['contact_name', 'contact_email']);
    const next = autofillClient(header, null, fields);
    assert.equal(next.contact_name, 'Manual'); assert.equal(next.contact_email, null);
    assert.deepEqual([...manualClientFields(header, [])], []);
    assert.deepEqual([...manualClientFields(header)], ['contact_name']);
  });
});
