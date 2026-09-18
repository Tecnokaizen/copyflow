import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { archivedOrderConflict } from "./lifecycle-rpc-error";
import {
  isArchivedApiError,
  lifecycleUxErrorMessage,
  OrderArchivedError,
  ORDER_ARCHIVED_CODE,
} from "./lifecycle-ux";

const root = path.join(import.meta.dirname, "../..");

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const EDIT_ROUTES = [
  ["content", "change_order_content"],
  ["details", "change_order_details"],
  ["management", "change_order_management"],
  ["notification", "change_order_notification_status"],
] as const;

describe("E1 · archived guard reaches the database", () => {
  const migration = read(
    "supabase/migrations/20260917214500_order_archived_immutability.sql"
  );

  const GUARDED_RPCS = [
    "change_order_content",
    "change_order_details",
    "change_order_management",
    "change_order_notification_status",
    "assign_order_client",
    "create_client_and_assign_order",
  ];

  for (const fn of GUARDED_RPCS) {
    it(`${fn} rejects archived orders before mutating`, () => {
      const start = migration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${fn} (`
      );
      assert.notEqual(start, -1, `${fn} missing from the migration`);

      const body = migration.slice(start, migration.indexOf("$function$;", start));

      const guard = body.indexOf("v_order.archived_at is not null");
      assert.notEqual(guard, -1, `${fn} has no archived guard`);

      // Lifecycle semantics, identical to change_order_status.
      assert.match(
        body.slice(guard, guard + 200),
        /raise exception 'order is archived'\s*\n\s*using errcode = '42501';/
      );

      // The guard must precede every write and every idempotent early return.
      const firstWrite = body.indexOf("update public.orders");
      assert.notEqual(firstWrite, -1, `${fn} never updates orders`);
      assert.ok(
        guard < firstWrite,
        `${fn} guard must run before the first update`
      );
    });
  }

  it("locks the order row before the guard so the check is not racy", () => {
    for (const fn of GUARDED_RPCS) {
      const start = migration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${fn} (`
      );
      const body = migration.slice(start, migration.indexOf("$function$;", start));
      const lock = body.indexOf("for update;");
      const guard = body.indexOf("v_order.archived_at is not null");

      assert.notEqual(lock, -1, `${fn} does not lock the order`);
      assert.ok(lock < guard, `${fn} must lock the order before the guard`);
    }
  });

  it("creates the client only after the archived guard", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.create_client_and_assign_order ("
    );
    const body = migration.slice(start, migration.indexOf("$function$;", start));

    const guard = body.indexOf("v_order.archived_at is not null");
    const insert = body.indexOf("insert into public.clients");

    assert.notEqual(insert, -1, "client insert not found");
    assert.ok(
      guard < insert,
      "an archived order must not leave an orphan client behind"
    );
  });

  it("does not touch Lifecycle V1 or Kiosk objects", () => {
    for (const untouchable of [
      "archive_order",
      "tg_orders_lifecycle_guard",
      "tg_activity_log_order_created",
      "app.kiosk_submission",
      "app.order_lifecycle",
    ]) {
      assert.equal(
        migration.includes(`FUNCTION public.${untouchable}`),
        false,
        `${untouchable} must not be redefined by E1`
      );
    }

    assert.equal(migration.includes("change_order_status ("), false);
  });

  it("ships a rollback that restores the unguarded bodies", () => {
    const rollback = read(
      "supabase/rollbacks/20260917214500_order_archived_immutability.sql"
    );

    assert.equal(rollback.includes("order is archived"), false);
    for (const fn of GUARDED_RPCS) {
      assert.ok(
        rollback.includes(`CREATE OR REPLACE FUNCTION public.${fn} (`),
        `${fn} missing from the rollback`
      );
    }
  });
});

describe("E1 · API maps the archived conflict to 409 ORDER_ARCHIVED", () => {
  it("archivedOrderConflict recognises the RPC message", () => {
    assert.deepEqual(
      archivedOrderConflict({ code: "42501", message: "order is archived" }),
      {
        status: 409,
        body: { error: "Order is archived", code: "ORDER_ARCHIVED" },
      }
    );
  });

  it("archivedOrderConflict ignores every other failure", () => {
    assert.equal(
      archivedOrderConflict({ code: "42501", message: "tenant access denied" }),
      null
    );
    assert.equal(
      archivedOrderConflict({ code: "23505", message: "client_duplicate" }),
      null
    );
    assert.equal(archivedOrderConflict(null), null);
  });

  it("never leaks raw SQL to the client", () => {
    const conflict = archivedOrderConflict({
      code: "42501",
      message: 'order is archived CONTEXT: PL/pgSQL function public.change_order_content',
    });

    assert.equal(conflict?.status, 409);
    assert.equal(conflict?.body.error, "Order is archived");
    assert.equal(JSON.stringify(conflict?.body).includes("PL/pgSQL"), false);
  });

  for (const [segment, rpc] of EDIT_ROUTES) {
    it(`/api/orders/[id]/${segment} routes ${rpc} failures through the shared mapper`, () => {
      const source = read("app", "api", "orders", "[id]", segment, "route.ts");

      assert.match(source, /mapLifecycleRpcError/);
      assert.match(source, /status: mapped\.status/);
      // The duplicated local SQLSTATE table is gone.
      assert.equal(source.includes("function statusForRpcError"), false);
    });
  }

  it("/api/orders/[id]/client answers ORDER_ARCHIVED on both verbs", () => {
    const source = read("app", "api", "orders", "[id]", "client", "route.ts");

    assert.match(source, /archivedOrderConflict/);
    // POST (create + assign) and PATCH (assign) both check it.
    assert.equal(source.split("archivedOrderConflict(error)").length - 1, 2);
    // The client duplicate contract survives.
    assert.match(source, /clientDuplicateResponse/);
  });
});

describe("E1 · client stops mutating when it loses the race", () => {
  it("isArchivedApiError only matches the archived conflict body", () => {
    assert.equal(isArchivedApiError({ code: ORDER_ARCHIVED_CODE }), true);
    assert.equal(isArchivedApiError({ code: "ORDER_NOT_TERMINAL" }), false);
    assert.equal(isArchivedApiError({ error: "Order is archived" }), false);
    assert.equal(isArchivedApiError(null), false);
    assert.equal(isArchivedApiError("ORDER_ARCHIVED"), false);
  });

  it("OrderArchivedError carries the existing Lifecycle copy", () => {
    const error = new OrderArchivedError();

    assert.ok(error instanceof Error);
    assert.equal(error.code, ORDER_ARCHIVED_CODE);
    assert.equal(
      error.message,
      lifecycleUxErrorMessage(ORDER_ARCHIVED_CODE)
    );
  });

  it("workspace revalidates before mutating and resyncs without a page reload", () => {
    const source = read("components/orders/detail/order-workspace.tsx");

    // Every entry point into a mutation revalidates first:
    // startEditing (opening the draft), saveEditing, runQuickSave.
    assert.equal(
      source.split(
        "canMutateOrderActions({ canWrite, archived_at: order.archived_at })"
      ).length - 1,
      3,
      "startEditing, saveEditing and runQuickSave must all revalidate"
    );

    // The multi-step save stops instead of pushing the remaining steps.
    assert.match(source, /if \(err instanceof OrderArchivedError\) \{/);
    assert.match(source, /archivedRace = true;\s*\n\s*break;/);
    assert.match(source, /if \(archivedRace\) \{/);

    // Recovery resyncs from the server; it never reloads the browser.
    assert.match(source, /async function recoverFromArchivedRace\(\)/);
    assert.match(source, /await Promise\.all\(\[loadOrder\(\), loadActivity\(\)\]\)/);
    assert.equal(source.includes("location.reload"), false);
    assert.equal(source.includes("window.location"), false);

    // The archived copy comes from the existing Lifecycle helper.
    assert.match(source, /setError\(lifecycleUxErrorMessage\(ORDER_ARCHIVED_CODE\)\)/);
  });

  it("client and archive mutations recover from the race too", () => {
    const source = read("components/orders/detail/order-workspace.tsx");

    // archiveOrder + assignExistingClient + saveClientForm(create).
    assert.ok(
      source.split("isArchivedApiError(result)").length - 1 >= 4,
      "every non-draft mutation must detect the archived conflict"
    );
  });
});
