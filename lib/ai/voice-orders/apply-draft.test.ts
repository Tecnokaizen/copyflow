import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyVoiceDraft,
  buildVoiceRevert,
  projectVoicePatch,
  recordVoiceApplication,
  voiceTouchedFromRestoredDraft,
  type VoiceFormSnapshot,
} from "@/lib/ai/voice-orders/apply-draft";
import { toDateTimeLocalValue } from "@/lib/orders/format";
import {
  VOICE_ORDER_DRAFT_VERSION,
  type VoiceOrderDraft,
} from "@/lib/ai/voice-orders/contract";

function baseDraft(overrides: Partial<VoiceOrderDraft> = {}): VoiceOrderDraft {
  return {
    version: VOICE_ORDER_DRAFT_VERSION,
    draft_id: "e4610000-0000-4000-8000-000000000099",
    tenant_slug: "demo",
    generated_at: new Date().toISOString(),
    transcript: {
      text: "pedido de tarjetas",
      source: "typed",
      language: "es",
      truncated: false,
    },
    fields: {
      title: { status: "proposed", value: "Tarjetas", confidence: "high", heard: null },
      description: { status: "proposed", value: "200 uds", confidence: "high", heard: null },
      notes: { status: "missing" },
      client: { status: "missing" },
      client_mention: null,
      service: {
        status: "proposed",
        value: { id: "svc-1", label: "Tarjetas" },
        confidence: "high",
        heard: null,
      },
      store: { status: "missing" },
      entry_channel: { status: "missing" },
      order_context: { status: "missing" },
      assigned_team_member: { status: "missing" },
      priority: { status: "missing" },
      due: { status: "missing" },
    },
    warnings: [],
    ...overrides,
  };
}

describe("applyVoiceDraft", () => {
  it("does not apply hidden quick fields", () => {
    const result = applyVoiceDraft(
      {
        title: "",
        description: "",
        notes: "",
        serviceId: "",
        storeId: "",
        entryChannelId: "",
        orderContextId: "",
        assignedTeamMemberId: "",
        priority: "normal",
        dueAt: "",
        clientId: null,
      },
      baseDraft(),
      {
        mode: "quick",
        visibleFields: ["title"],
        touchedFields: {},
        tenantSlug: "demo",
      }
    );

    assert.equal(result.patch.title, "Tarjetas");
    assert.equal(result.patch.serviceId, undefined);
    assert.ok(result.report.some((item) => item.action === "skipped_hidden"));
  });

  it("does not overwrite touched fields", () => {
    const result = applyVoiceDraft(
      {
        title: "Manual",
        description: "",
        notes: "",
        serviceId: "",
        storeId: "",
        entryChannelId: "",
        orderContextId: "",
        assignedTeamMemberId: "",
        priority: "normal",
        dueAt: "",
        clientId: null,
      },
      baseDraft(),
      {
        mode: "full",
        visibleFields: ["title", "service", "description"],
        touchedFields: { title: true },
        tenantSlug: "demo",
      }
    );

    assert.equal(result.patch.title, undefined);
    assert.equal(result.patch.serviceId, "svc-1");
  });

  it("discards drafts from another tenant", () => {
    const result = applyVoiceDraft(
      {
        title: "",
        description: "",
        notes: "",
        serviceId: "",
        storeId: "",
        entryChannelId: "",
        orderContextId: "",
        assignedTeamMemberId: "",
        priority: "normal",
        dueAt: "",
        clientId: null,
      },
      baseDraft({ tenant_slug: "other" }),
      {
        mode: "full",
        visibleFields: ["title"],
        touchedFields: {},
        tenantSlug: "demo",
      }
    );

    assert.deepEqual(result.patch, {});
  });
});

function emptyForm(overrides: Partial<VoiceFormSnapshot> = {}): VoiceFormSnapshot {
  return {
    title: "",
    description: "",
    notes: "",
    serviceId: "",
    storeId: "store-default",
    entryChannelId: "",
    orderContextId: "",
    assignedTeamMemberId: "",
    priority: "normal",
    dueAt: "",
    clientId: null,
    ...overrides,
  };
}

function applyTo(form: VoiceFormSnapshot, projected: Partial<VoiceFormSnapshot>) {
  return { ...form, ...projected };
}

const FULL = {
  mode: "full" as const,
  visibleFields: [],
  touchedFields: {},
  tenantSlug: "demo",
};

describe("voice draft discard", () => {
  it("puts back every field the draft wrote, including the date", () => {
    const dueAtIso = "2026-10-20T08:00:00.000Z";
    const draft = baseDraft();
    draft.fields.priority = { status: "proposed", value: "urgent", confidence: "high", heard: null };
    draft.fields.store = {
      status: "proposed",
      value: { id: "store-2", label: "Centro" },
      confidence: "high",
      heard: null,
    };
    draft.fields.due = {
      status: "proposed",
      value: {
        due_at_iso: dueAtIso,
        civil_date: "2026-10-20",
        time: "10:00",
        timezone: "Europe/Madrid",
        expression: "pasado mañana a las diez",
      },
      confidence: "high",
      heard: null,
    };
    const before = emptyForm();
    const result = applyVoiceDraft(before, draft, FULL);
    const projected = projectVoicePatch(before, result.patch);
    assert.equal(projected.dueAt, toDateTimeLocalValue(dueAtIso));
    assert.equal(projected.storeId, "store-2");

    const applied = recordVoiceApplication({}, before, projected);
    const revert = buildVoiceRevert(applied, applyTo(before, projected));

    assert.deepEqual(revert.kept, []);
    assert.deepEqual(applyTo(applyTo(before, projected), revert.restore), before);
  });

  it("keeps fields the user changed after the draft and restores the rest", () => {
    const before = emptyForm();
    const result = applyVoiceDraft(before, baseDraft(), FULL);
    const projected = projectVoicePatch(before, result.patch);
    const applied = recordVoiceApplication({}, before, projected);
    const edited = { ...applyTo(before, projected), title: "Tarjetas 9x5 (corregido)" };

    const revert = buildVoiceRevert(applied, edited);

    assert.deepEqual(revert.kept, ["title"]);
    assert.equal(revert.restore.title, undefined);
    assert.equal(revert.restore.serviceId, "");
    assert.equal(revert.restore.description, "");
  });

  it("removes only the appended dictation from an existing description", () => {
    const before = emptyForm({ description: "<p>Papel reciclado</p>" });
    const result = applyVoiceDraft(before, baseDraft(), FULL);
    assert.equal(result.patch.descriptionMode, "append");
    const projected = projectVoicePatch(before, result.patch);
    assert.equal(projected.description, "<p>Papel reciclado</p><p>200 uds</p>");

    const applied = recordVoiceApplication({}, before, projected);
    const revert = buildVoiceRevert(applied, applyTo(before, projected));

    assert.equal(revert.restore.description, "<p>Papel reciclado</p>");
  });

  it("undoes «Reemplazar» back to the value typed before the draft", () => {
    const before = emptyForm({ title: "Manual" });
    const touched = { title: true };
    const first = applyVoiceDraft(before, baseDraft(), { ...FULL, touchedFields: touched });
    assert.equal(first.patch.title, undefined);
    let applied = recordVoiceApplication({}, before, projectVoicePatch(before, first.patch));
    const afterFirst = applyTo(before, projectVoicePatch(before, first.patch));

    const replaced = applyVoiceDraft(afterFirst, baseDraft(), {
      ...FULL,
      touchedFields: { title: false },
    });
    const titleOnly = { title: replaced.patch.title };
    applied = recordVoiceApplication(applied, afterFirst, projectVoicePatch(afterFirst, titleOnly));
    const afterReplace = applyTo(afterFirst, projectVoicePatch(afterFirst, titleOnly));
    assert.equal(afterReplace.title, "Tarjetas");

    const revert = buildVoiceRevert(applied, afterReplace);
    assert.equal(revert.restore.title, "Manual");
    assert.deepEqual(applyTo(afterReplace, revert.restore), before);
  });

  it("does not touch fields the draft left as they were", () => {
    const before = emptyForm({ serviceId: "svc-1" });
    const result = applyVoiceDraft(before, baseDraft(), FULL);
    const applied = recordVoiceApplication({}, before, projectVoicePatch(before, result.patch));
    assert.equal(applied.serviceId, undefined);
  });
});

describe("restored session draft and voice", () => {
  it("marks as touched only what differs from the empty form and its defaults", () => {
    const defaults = emptyForm();
    const restored = emptyForm({
      title: "Carteles",
      dueAt: "2026-10-21T12:00",
      priority: "high",
      clientId: "client-1",
    });

    assert.deepEqual(voiceTouchedFromRestoredDraft(restored, defaults), {
      title: true,
      dueAt: true,
      priority: true,
      clientId: true,
    });
    assert.deepEqual(voiceTouchedFromRestoredDraft(defaults, defaults), {});
  });

  it("then keeps the restored fields out of the voice patch", () => {
    const restored = emptyForm({ title: "Carteles" });
    const touched = voiceTouchedFromRestoredDraft(restored, emptyForm());
    const result = applyVoiceDraft(restored, baseDraft(), { ...FULL, touchedFields: touched });
    assert.equal(result.patch.title, undefined);
    assert.ok(result.report.some((item) => item.field === "title" && item.action === "skipped_touched"));
  });
});
