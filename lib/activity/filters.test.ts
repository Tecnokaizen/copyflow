import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { actionsForEntity, formatActivityEvent } from "./format";
import {
  ASSIGNEE_ACTIVITY_FIELD,
  ASSIGNEE_ACTIVITY_FILTER,
  isAssigneeActivityEvent,
  matchesActivityActionFilter,
  withOrderNavigation,
} from "./filters";
import { ACTION_OPTIONS, type ActivityEvent } from "./types";

const ORDER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_TENANT_ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function stored(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt-1",
    created_at: "2026-10-08T10:00:00.000Z",
    actor_type: "user",
    actor_name: "Ana",
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    team_member_id: null,
    action: "order.details_changed",
    entity_type: "order",
    entity_id: ORDER_ID,
    entity_label: "SUR4-0010",
    changed_field: ASSIGNEE_ACTIVITY_FIELD,
    previous_values: { value_name: "Hugo Martín" },
    new_values: { value_name: "Iván Ruiz" },
    metadata: {
      reference: "SUR4-0010",
      field: ASSIGNEE_ACTIVITY_FIELD,
    },
    ...overrides,
  };
}

describe("assignee activity filter", () => {
  it("places Cambio de responsable immediately after Cambio de estado", () => {
    const options = actionsForEntity("order");
    const labels = options.map((option) => option.label);
    assert.equal(
      labels.indexOf("Cambio de responsable"),
      labels.indexOf("Cambio de estado") + 1
    );
    assert.equal(options[labels.indexOf("Cambio de responsable")]?.value, ASSIGNEE_ACTIVITY_FILTER);
    assert.equal(labels.filter((label) => label === "Cambio de responsable").length, 1);
    assert.equal(labels.includes("Cambio de detalles"), true);
    assert.equal(actionsForEntity("quote").some((option) => option.value === ASSIGNEE_ACTIVITY_FILTER), false);
    assert.deepEqual(
      actionsForEntity("client").map((option) => option.value),
      ACTION_OPTIONS.filter((option) => option.value.startsWith("client.")).map(
        (option) => option.value
      )
    );
  });

  it("keeps assignee changes out of the generic details filter", () => {
    const assignee = stored();
    const priority = stored({
      id: "evt-2",
      changed_field: "priority",
      previous_values: { value: "normal" },
      new_values: { value: "urgent" },
    });
    const unidentified = stored({
      id: "evt-3",
      changed_field: null,
      metadata: { reference: "SUR4-0010" },
    });

    assert.equal(isAssigneeActivityEvent(assignee), true);
    assert.equal(matchesActivityActionFilter(assignee, ASSIGNEE_ACTIVITY_FILTER), true);
    assert.equal(matchesActivityActionFilter(priority, ASSIGNEE_ACTIVITY_FILTER), false);
    assert.equal(matchesActivityActionFilter(unidentified, ASSIGNEE_ACTIVITY_FILTER), false);
    assert.equal(matchesActivityActionFilter(assignee, "order.details_changed"), false);
    assert.equal(matchesActivityActionFilter(priority, "order.details_changed"), true);
    assert.equal(matchesActivityActionFilter(unidentified, "order.details_changed"), true);
    assert.equal(matchesActivityActionFilter(priority, "order.status_changed"), false);
    assert.equal(matchesActivityActionFilter(stored({ action: "order.status_changed", changed_field: "status" }), "order.status_changed"), true);
    assert.equal(matchesActivityActionFilter(assignee, null), true);
  });

  it("shows the previous and next assignee without a second event", () => {
    const formatted = formatActivityEvent(stored());
    assert.equal(formatted.actor, "Ana");
    assert.equal(formatted.headline, "Cambió el responsable de SUR4-0010");
    assert.equal(formatted.changes[0]?.label, "Responsable");
    assert.equal(formatted.changes[0]?.from, "Hugo Martín");
    assert.equal(formatted.changes[0]?.to, "Iván Ruiz");
    assert.equal(formatted.changes.length, 1);
  });

  it("links the readable order number only when that order is visible", () => {
    const [visible, missing, foreign, quote] = withOrderNavigation(
      [
        stored(),
        stored({ id: "evt-missing", entity_id: OTHER_TENANT_ORDER, entity_label: "SUR4-0099" }),
        stored({ id: "evt-foreign", entity_id: OTHER_TENANT_ORDER }),
        stored({
          id: "evt-quote",
          action: "quote.created",
          entity_type: "quote",
          entity_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          entity_label: "SUR4-P0001",
          changed_field: null,
        }),
      ],
      new Set([ORDER_ID])
    );

    const linked = formatActivityEvent(visible);
    assert.equal(linked.href, `/orders/${ORDER_ID}`);
    assert.equal(linked.entityLabel, "SUR4-0010");
    assert.equal(linked.href?.includes("SUR4"), false);

    const unavailable = formatActivityEvent(missing);
    assert.equal(unavailable.href, null);
    assert.match(unavailable.headline, /SUR4-0099/);

    assert.equal(formatActivityEvent(foreign).href, null);
    assert.equal(
      formatActivityEvent(quote).href,
      "/quotes/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    );
  });

  it("keeps the same predicate in the activity query", () => {
    const sql = readFileSync(
      new URL(
        "../../supabase/migrations/20261008193000_activity_assignee_filter.sql",
        import.meta.url
      ),
      "utf8"
    );
    assert.match(sql, /v_action = 'order\.assignee_changed'/);
    assert.match(sql, /al\.action = 'order\.details_changed'/);
    assert.match(sql, /al\.metadata ->> 'field' = 'assigned_team_member_id'/);
    assert.match(sql, /is distinct from 'assigned_team_member_id'/);
    assert.equal(sql.includes("UPDATE public.activity_log"), false);
    assert.equal(sql.includes("ALTER TABLE"), false);

    const card = readFileSync(
      new URL("../../components/activity/activity-event-card.tsx", import.meta.url),
      "utf8"
    );
    assert.match(card, /from "next\/link"/);
    assert.match(card, /text-primary hover:underline/);
    assert.match(card, /href=\{href\}/);

    const route = readFileSync(
      new URL("../../app/api/activity/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(route, /\.eq\("tenant_id", tenantId\)/);
    assert.match(route, /\.from\("orders"\)/);
  });
});
