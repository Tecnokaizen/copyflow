import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatActivityEvent } from "@/lib/activity/format";
import type { ActivityEvent } from "@/lib/activity/types";
import { buildCreateOrderPayload } from "./create-form";
import { deriveOrderTitle } from "./create";
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
      description: "<p>50 color</p>",
      due_at: "2026-09-15T10:00:00.000Z",
      entry_channel_id: "channel-1",
      order_context_id: null,
      priority: "urgent",
      assigned_team_member_id: "member-1",
      store_id: "store-1",
      notes: "<p>interno</p>",
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
        description: "<p>50 color</p>",
        due_at: "2026-09-15T10:00:00.000Z",
        entry_channel_id: "channel-1",
        order_context_id: null,
        priority: "urgent",
        assigned_team_member_id: "member-1",
        store_id: "store-1",
        notes: "<p>interno</p>",
      }
    );
  });

  it("persists a custom title and keeps the automatic fallback", () => {
    assert.equal(
      buildCreateOrderPayload({
        ...PAYLOAD_INPUT,
        title: deriveOrderTitle({
          title: "Carteles feria",
          description: "otra descripción",
          serviceName: "Copias",
        }),
      }).title,
      "Carteles feria"
    );
    assert.equal(
      deriveOrderTitle({ title: "", description: "", serviceName: "Copias" }),
      "Copias"
    );
    assert.equal(
      deriveOrderTitle({ title: "   ", description: "", serviceName: "" }),
      "Pedido"
    );

    const created: ActivityEvent = {
      id: "evt-title",
      created_at: "2026-10-08T10:00:00.000Z",
      actor_type: "user",
      actor_name: "Ana",
      user_id: null,
      team_member_id: null,
      action: "order.created",
      entity_type: "order",
      entity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      entity_label: "GC-0010",
      changed_field: null,
      previous_values: null,
      new_values: { title: "200 tarjetas de visita" },
      metadata: { reference: "GC-0010" },
    };
    const activity = formatActivityEvent(created);
    assert.equal(
      activity.changes.some(
        (change) =>
          change.label === "Título" && change.to === "200 tarjetas de visita"
      ),
      true
    );
  });

  it("asks for the order title before the client in both create forms", () => {
    const form = readFileSync(
      new URL("../../components/orders/create-order-form.tsx", import.meta.url),
      "utf8"
    );
    assert.match(form, /Título del pedido/);
    assert.match(form, /Ej\. 200 tarjetas de visita/);
    assert.match(
      form,
      /Registra el pedido con su título y los datos imprescindibles\./
    );
    assert.equal(form.includes("El resto se puede completar en la ficha"), false);
    assert.equal(
      readFileSync(
        new URL("../../app/orders/quick/page.tsx", import.meta.url),
        "utf8"
      ).includes("El resto se completa en la ficha"),
      false
    );
    assert.match(
      form,
      /Registra un nuevo pedido y completa los datos necesarios para su gestión\./
    );
    assert.equal(form.includes("Datos mínimos para registrar el trabajo"), false);
    assert.match(form, /title: derivedTitle/);
    assert.match(form, /field !== "title"/);

    const body = form.slice(form.indexOf("<form"));
    const fullBranch = body.slice(body.indexOf(") : ("));
    assert.ok(fullBranch.indexOf("{renderTitleField()}") >= 0);
    assert.ok(
      fullBranch.indexOf("{renderTitleField()}") <
        fullBranch.indexOf("{renderClientField()}")
    );
    assert.equal(
      fullBranch.slice(fullBranch.indexOf("<details")).includes("{renderTitleField()}"),
      false
    );

    const quickBranch = body.slice(
      body.indexOf("{isQuick ? ("),
      body.indexOf(") : (")
    );
    assert.ok(
      quickBranch.includes("{renderTitleField()}") &&
        quickBranch.indexOf("{renderTitleField()}") <
          quickBranch.indexOf("quickSections.overviewFields.map")
    );

    const ordersPage = readFileSync(
      new URL("../../app/orders/page.tsx", import.meta.url),
      "utf8"
    );
    const list = ordersPage.slice(ordersPage.indexOf("listOrders.map"));
    const calendar = ordersPage.slice(ordersPage.indexOf("dayOrders.map"));
    const service = ordersPage.slice(ordersPage.indexOf("serviceDetailOrders.map"));
    assert.match(list, /\{order\.title\}/);
    assert.match(calendar, /\{order\.title\}/);
    assert.match(service, /\{order\.title\}/);
    assert.match(
      readFileSync(
        new URL("../../components/orders/detail/order-header.tsx", import.meta.url),
        "utf8"
      ),
      /order\.title/
    );
    assert.match(
      readFileSync(
        new URL("../../components/dashboard/tenant-dashboard.tsx", import.meta.url),
        "utf8"
      ),
      /\{order\.title\}/
    );
    assert.match(
      readFileSync(new URL("../../app/api/orders/route.ts", import.meta.url), "utf8"),
      /title is required/
    );
    assert.match(
      readFileSync(new URL("../../app/api/orders/route.ts", import.meta.url), "utf8"),
      /insert\(\{[\s\S]*title,/
    );
  });
});
