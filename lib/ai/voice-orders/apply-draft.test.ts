import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyVoiceDraft } from "@/lib/ai/voice-orders/apply-draft";
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
