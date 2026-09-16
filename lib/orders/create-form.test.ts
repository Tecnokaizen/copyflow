import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCreateOrderPayload } from "./create-form";
import { fieldsForPlacement } from "@/lib/settings/quick-order-layout";

const PAYLOAD_INPUT = {
  title: "Tarjetas",
  clientId: "client-1",
  serviceId: "service-1",
  description: "  50 color  ",
  dueAtIso: "2026-09-15T10:00:00.000Z",
  entryChannelId: "channel-1",
  orderContextId: "",
  priority: "urgent" as const,
  assignedTeamMemberId: "member-1",
  storeId: "store-1",
  notes: "  interno  ",
};

describe("CreateOrderForm payload is shared across modes", () => {
  it("posts the same /api/orders body in full and quick modes", () => {
    const full = buildCreateOrderPayload(PAYLOAD_INPUT);
    const quick = buildCreateOrderPayload({ ...PAYLOAD_INPUT });

    assert.deepEqual(full, quick);
    assert.deepEqual(full, {
      title: "Tarjetas",
      client_id: "client-1",
      service_id: "service-1",
      description: "50 color",
      due_at: "2026-09-15T10:00:00.000Z",
      entry_channel_id: "channel-1",
      order_context_id: null,
      priority: "urgent",
      assigned_team_member_id: "member-1",
      store_id: "store-1",
      notes: "interno",
    });
  });

  it("sends nulls for empty optional fields without changing the POST shape", () => {
    assert.deepEqual(
      buildCreateOrderPayload({
        title: "Pedido",
        clientId: null,
        serviceId: "",
        description: "",
        dueAtIso: null,
        entryChannelId: "",
        orderContextId: "",
        priority: "normal",
        assignedTeamMemberId: "",
        storeId: "",
        notes: "",
      }),
      {
        title: "Pedido",
        client_id: null,
        service_id: null,
        description: null,
        due_at: null,
        entry_channel_id: null,
        order_context_id: null,
        priority: "normal",
        assigned_team_member_id: null,
        store_id: null,
        notes: null,
      }
    );
  });

  it("persists every value when fields move between quick form sections", () => {
    const movedLayout = {
      client: "more",
      service: "more",
      description: "more",
      store: "more",
      due_at: "more",
      priority: "more",
      assigned_team_member: "more",
      entry_channel: "primary",
      title: "primary",
      order_context: "primary",
      notes: "primary",
    } as const;

    assert.deepEqual(fieldsForPlacement(movedLayout, "primary"), [
      "entry_channel",
      "title",
      "order_context",
      "notes",
    ]);
    assert.deepEqual(
      buildCreateOrderPayload(PAYLOAD_INPUT),
      {
        title: "Tarjetas",
        client_id: "client-1",
        service_id: "service-1",
        description: "50 color",
        due_at: "2026-09-15T10:00:00.000Z",
        entry_channel_id: "channel-1",
        order_context_id: null,
        priority: "urgent",
        assigned_team_member_id: "member-1",
        store_id: "store-1",
        notes: "interno",
      }
    );
  });
});
