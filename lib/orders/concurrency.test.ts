import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyReturnedVersion,
  omitRowVersion,
  omitRowVersionFromList,
  parseExpectedVersion,
  rpcExpectedVersionArg,
  staleSaveMessage,
  toPublicOrderDto,
} from "./concurrency";
import { mapLifecycleRpcError } from "./lifecycle-rpc-error";
import {
  isArchivedApiError,
  isStaleApiError,
  lifecycleUxErrorMessage,
  ORDER_ARCHIVED_CODE,
  ORDER_STALE_CODE,
  OrderStaleError,
} from "./lifecycle-ux";

const root = path.join(import.meta.dirname, "../..");

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function assertNoNumericVersionConversion(source: string, label: string) {
  assert.equal(
    source.includes("Number(version"),
    false,
    `${label} must not Number(version)`
  );
  assert.equal(
    source.includes("parseInt(version"),
    false,
    `${label} must not parseInt(version)`
  );
  assert.equal(
    source.includes("parseFloat(version"),
    false,
    `${label} must not parseFloat(version)`
  );
  assert.equal(
    source.includes("Date(version"),
    false,
    `${label} must not Date(version)`
  );
}

describe("parseExpectedVersion", () => {
  it("accepts a non-empty decimal digit string including 0", () => {
    assert.equal(parseExpectedVersion("0"), "0");
    assert.equal(parseExpectedVersion("1"), "1");
    assert.equal(parseExpectedVersion("42"), "42");
    assert.equal(parseExpectedVersion("9007199254740993"), "9007199254740993");
  });

  it("rejects missing, empty, non-string, signed, and non-digit values", () => {
    assert.equal(parseExpectedVersion(undefined), null);
    assert.equal(parseExpectedVersion(null), null);
    assert.equal(parseExpectedVersion(""), null);
    assert.equal(parseExpectedVersion("   "), null);
    assert.equal(parseExpectedVersion(0), null);
    assert.equal(parseExpectedVersion(1), null);
    assert.equal(parseExpectedVersion("abc"), null);
    assert.equal(parseExpectedVersion("-1"), null);
    assert.equal(parseExpectedVersion("1.5"), null);
    assert.equal(parseExpectedVersion("1e2"), null);
    assert.equal(parseExpectedVersion(" 0"), null);
    assert.equal(parseExpectedVersion("0 "), null);
  });

  it("returns the same token without converting it to Number", () => {
    const token = parseExpectedVersion("0");
    assert.equal(token, "0");
    assert.equal(typeof token, "string");
    assert.equal(rpcExpectedVersionArg("0"), "0");
    assert.equal(typeof rpcExpectedVersionArg("0"), "string");
  });
});

describe("ORDER_STALE mapper", () => {
  it("maps GCO01 and the DB message to 409 ORDER_STALE", () => {
    assert.deepEqual(
      mapLifecycleRpcError({
        code: "GCO01",
        message: "order has been modified since last read",
      }),
      {
        status: 409,
        body: {
          error: "Order has been modified since last read",
          code: "ORDER_STALE",
        },
      }
    );
  });

  it("keeps ORDER_ARCHIVED ahead of stale", () => {
    assert.deepEqual(
      mapLifecycleRpcError({
        code: "GCO01",
        message: "order is archived",
      }),
      {
        status: 409,
        body: { error: "Order is archived", code: "ORDER_ARCHIVED" },
      }
    );
  });

  it("does not leak SQLSTATE, SQL, or function names", () => {
    const mapped = mapLifecycleRpcError({
      code: "GCO01",
      message:
        "order has been modified since last read CONTEXT: PL/pgSQL function public.change_order_content_v2",
    });
    const serialized = JSON.stringify(mapped.body);
    assert.equal(mapped.status, 409);
    assert.equal(mapped.body.code, "ORDER_STALE");
    assert.equal(serialized.includes("GCO01"), false);
    assert.equal(serialized.includes("PL/pgSQL"), false);
    assert.equal(serialized.includes("change_order_content_v2"), false);
    assert.equal(serialized.includes("row_version"), false);
  });
});

describe("isStaleApiError / OrderStaleError", () => {
  it("isStaleApiError only matches ORDER_STALE", () => {
    assert.equal(isStaleApiError({ code: ORDER_STALE_CODE }), true);
    assert.equal(isArchivedApiError({ code: ORDER_STALE_CODE }), false);
    assert.equal(isStaleApiError({ code: ORDER_ARCHIVED_CODE }), false);
    assert.equal(
      isStaleApiError({ error: "Order has been modified since last read" }),
      false
    );
    assert.equal(isStaleApiError(null), false);
    assert.equal(isStaleApiError("ORDER_STALE"), false);
  });

  it("OrderStaleError carries the Spanish copy", () => {
    const error = new OrderStaleError();
    assert.ok(error instanceof Error);
    assert.equal(error.code, ORDER_STALE_CODE);
    assert.equal(error.message, lifecycleUxErrorMessage(ORDER_STALE_CODE));
    assert.match(error.message, /ha cambiado desde que empezaste a editarlo/);
  });
});

describe("GET version DTO", () => {
  it("publishes version and hides row_version", () => {
    const publicOrder = toPublicOrderDto({
      id: "order-1",
      title: "Tarjetas",
      row_version: 0,
      archived_at: null,
    });
    assert.equal(publicOrder.version, "0");
    assert.equal("row_version" in publicOrder, false);
    assert.equal(publicOrder.id, "order-1");
  });

  it("stringifies bigint-range tokens without Number()", () => {
    const publicOrder = toPublicOrderDto({
      id: "order-1",
      row_version: "9007199254740993",
    });
    assert.equal(publicOrder.version, "9007199254740993");
    assert.equal(typeof publicOrder.version, "string");
  });

  it("GET route maps through toPublicOrderDto and never returns row_version", () => {
    const source = read("app", "api", "orders", "[id]", "route.ts");
    assert.match(source, /toPublicOrderDto/);
    assert.match(source, /export async function GET/);
    assert.equal(source.includes("order.row_version"), false);
    assert.equal(source.includes("row_version:"), false);
  });
});

describe("list/create row_version leakage", () => {
  it("omitRowVersion strips the internal column without adding version", () => {
    const publicRow = omitRowVersion({
      id: "order-1",
      title: "Tarjetas",
      row_version: 4,
    });
    assert.equal("row_version" in publicRow, false);
    assert.equal("version" in publicRow, false);
    assert.equal(publicRow.id, "order-1");
    assert.equal(publicRow.title, "Tarjetas");
  });

  it("omitRowVersionFromList strips nested list rows", () => {
    const rows = omitRowVersionFromList([
      { id: "a", row_version: 0 },
      { id: "b", row_version: 2, title: "B" },
    ]);
    assert.deepEqual(rows, [{ id: "a" }, { id: "b", title: "B" }]);
  });

  it("GET/POST /api/orders strip row_version and do not publish version", () => {
    const source = read("app", "api", "orders", "route.ts");
    assert.match(source, /omitRowVersionFromList/);
    assert.match(source, /omitRowVersion\(order/);
    assert.equal(source.includes("toPublicOrderDto"), false);
  });

  it("mine, counter, dashboard, client orders and activity omit row_version", () => {
    const files = [
      ["app", "api", "orders", "mine", "route.ts"],
      ["app", "api", "orders", "counter", "route.ts"],
      ["app", "api", "dashboard", "route.ts"],
      ["app", "api", "clients", "[id]", "route.ts"],
      ["app", "api", "orders", "[id]", "activity", "route.ts"],
    ];
    for (const parts of files) {
      const source = read(...parts);
      assert.equal(
        source.includes("row_version"),
        false,
        `${parts.join("/")} must not mention row_version`
      );
    }
  });
});

describe("version propagation", () => {
  it("applyReturnedVersion replaces the token from the RPC payload", () => {
    const next = applyReturnedVersion(
      { id: "order-1", version: "0", title: "A" },
      { version: "1", order: { title: "B" } }
    );
    assert.equal(next.version, "1");
    assert.equal(next.id, "order-1");
    assert.equal(typeof next.version, "string");
  });

  it("chains V1 -> V2 -> V3 instead of reusing the initial token", () => {
    let working = { id: "order-1", version: "4" };
    working = applyReturnedVersion(working, { version: "5" });
    working = applyReturnedVersion(working, { version: "6" });
    assert.equal(working.version, "6");
  });
});

describe("stale UX copy", () => {
  it("keeps the base copy when no step succeeded", () => {
    assert.equal(
      staleSaveMessage(0),
      "Este pedido ha cambiado desde que empezaste a editarlo."
    );
  });

  it("mentions a single saved change", () => {
    assert.equal(
      staleSaveMessage(1),
      "Este pedido ha cambiado desde que empezaste a editarlo. Se guardó 1 cambio."
    );
  });

  it("mentions N saved changes", () => {
    assert.equal(
      staleSaveMessage(3),
      "Este pedido ha cambiado desde que empezaste a editarlo. Se guardaron 3 cambios."
    );
  });
});

describe("E2A productive callers and workspace contracts", () => {
  const V2_CALLERS: Array<[string[], string]> = [
    [["app", "api", "orders", "[id]", "route.ts"], "change_order_status_v2"],
    [["app", "api", "orders", "[id]", "content", "route.ts"], "change_order_content_v2"],
    [["app", "api", "orders", "[id]", "details", "route.ts"], "change_order_details_v2"],
    [
      ["app", "api", "orders", "[id]", "management", "route.ts"],
      "change_order_management_v2",
    ],
    [
      ["app", "api", "orders", "[id]", "notification", "route.ts"],
      "change_order_notification_status_v2",
    ],
    [["app", "api", "orders", "[id]", "client", "route.ts"], "assign_order_client_v2"],
    [
      ["app", "api", "orders", "[id]", "client", "route.ts"],
      "create_client_and_assign_order_v2",
    ],
  ];

  for (const [parts, rpc] of V2_CALLERS) {
    it(`${parts.join("/")} calls ${rpc}`, () => {
      const source = read(...parts);
      assert.match(source, new RegExp(`rpc\\(\\s*["']${rpc}["']`));
    });
  }

  it("console.error labels match the v2 RPC names", () => {
    const labels: Array<[string[], string]> = [
      [["app", "api", "orders", "[id]", "route.ts"], "change_order_status_v2 failed"],
      [["app", "api", "orders", "[id]", "content", "route.ts"], "change_order_content_v2 failed"],
      [["app", "api", "orders", "[id]", "details", "route.ts"], "change_order_details_v2 failed"],
      [["app", "api", "orders", "[id]", "management", "route.ts"], "change_order_management_v2 failed"],
      [
        ["app", "api", "orders", "[id]", "notification", "route.ts"],
        "change_order_notification_status_v2 failed",
      ],
      [["app", "api", "orders", "[id]", "client", "route.ts"], "assign_order_client_v2 failed"],
      [
        ["app", "api", "orders", "[id]", "client", "route.ts"],
        "create_client_and_assign_order_v2 failed",
      ],
    ];
    const v1Names = [
      "change_order_content failed",
      "change_order_details failed",
      "change_order_management failed",
      "change_order_notification_status failed",
      "assign_order_client failed",
      "create_client_and_assign_order failed",
      "change_order_status failed",
    ];
    for (const [parts, label] of labels) {
      const source = read(...parts);
      assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      for (const stale of v1Names) {
        assert.equal(source.includes(stale), false, `${parts.join("/")} still logs "${stale}"`);
      }
    }
  });

  it("archive stays on archive_order without expected_version", () => {
    const source = read("app", "api", "orders", "[id]", "archive", "route.ts");
    assert.match(source, /rpc\(\s*["']archive_order["']/);
    assert.equal(source.includes("expected_version"), false);
    assert.equal(source.includes("_v2"), false);
  });

  it("workspace send/propagate version, stop on stale, keep draft", () => {
    const source = read("components/orders/detail/order-workspace.tsx");

    assert.match(source, /expected_version:\s*current\.version/);
    assert.match(source, /applyReturnedVersion/);
    assert.match(source, /if \(err instanceof OrderStaleError\) \{/);
    assert.match(source, /staleRace = true;\s*\n\s*break;/);
    assert.match(source, /async function recoverFromStale/);
    assert.match(source, /recoverFromStale\(succeeded\.length\)/);
    assert.match(source, /setError\(staleSaveMessage\(succeededCount\)\)/);
    assert.equal(source.includes("location.reload"), false);
    assert.equal(source.includes("window.location"), false);

    const staleFnStart = source.indexOf("async function recoverFromStale");
    const staleFn = source.slice(staleFnStart, source.indexOf("async function recoverFromArchivedRace"));
    assert.equal(staleFn.includes("setEditing(false)"), false);
    assert.equal(staleFn.includes("setDraft(null)"), false);
  });

  it("quick actions and client assignment send order.version", () => {
    const source = read("components/orders/detail/order-workspace.tsx");
    assert.match(source, /expected_version:\s*order\.version/);
    assert.match(source, /isStaleApiError\(result\)/);
  });

  it("does not convert version with Number/Date", () => {
    const files = [
      ["lib", "orders", "concurrency.ts"],
      ["lib", "orders", "lifecycle-rpc-error.ts"],
      ["lib", "orders", "lifecycle-ux.ts"],
      ["lib", "orders", "change-status-api.ts"],
      ["app", "api", "orders", "[id]", "route.ts"],
      ["app", "api", "orders", "[id]", "content", "route.ts"],
      ["app", "api", "orders", "[id]", "details", "route.ts"],
      ["app", "api", "orders", "[id]", "management", "route.ts"],
      ["app", "api", "orders", "[id]", "notification", "route.ts"],
      ["app", "api", "orders", "[id]", "client", "route.ts"],
      ["components", "orders", "detail", "order-workspace.tsx"],
    ];
    for (const parts of files) {
      assertNoNumericVersionConversion(read(...parts), parts.join("/"));
    }
  });
});

// =============================================================================
// E2B CONTRACT TESTS — v1 RPCs retired, no fallback, no silent caller
// =============================================================================
describe("E2B: v1 RPCs absent from all productive callers", () => {
  // Productive source paths that call Supabase RPCs
  const productiveSources: Array<[string[], string]> = [
    [["app", "api", "orders", "[id]", "route.ts"], "PATCH order"],
    [["app", "api", "orders", "[id]", "content", "route.ts"], "PATCH content"],
    [["app", "api", "orders", "[id]", "details", "route.ts"], "PATCH details"],
    [["app", "api", "orders", "[id]", "management", "route.ts"], "PATCH management"],
    [["app", "api", "orders", "[id]", "notification", "route.ts"], "PATCH notification"],
    [["app", "api", "orders", "[id]", "client", "route.ts"], "PATCH client"],
    [["app", "api", "orders", "route.ts"], "POST/GET orders"],
    [["components", "orders", "detail", "order-workspace.tsx"], "OrderWorkspace"],
    [["lib", "orders", "change-status-api.ts"], "change-status-api"],
    [["lib", "orders", "concurrency.ts"], "concurrency helpers"],
    [["lib", "orders", "lifecycle-rpc-error.ts"], "lifecycle-rpc-error"],
    [["lib", "orders", "lifecycle-ux.ts"], "lifecycle-ux"],
  ];

  // v1 RPC names that must not appear as rpc() calls in productive code
  const v1RpcNames = [
    "change_order_content",
    "change_order_details",
    "change_order_management",
    "change_order_notification_status",
    "assign_order_client",
    "create_client_and_assign_order",
    "change_order_status",
  ] as const;

  for (const [parts, label] of productiveSources) {
    it(`${label} does not call any v1 RPC`, () => {
      const source = read(...parts);
      for (const v1Name of v1RpcNames) {
        // Only flag actual rpc() calls, not _v2 variants or string literals in comments
        const rpcCallPattern = new RegExp(`\\.rpc\\(\\s*["'\`]${v1Name}["'\`]`);
        assert.equal(
          rpcCallPattern.test(source),
          false,
          `${label} still calls v1 RPC .rpc("${v1Name}") — must use _v2 variant`,
        );
      }
    });
  }

  it("all productive rpc() calls in API routes use _v2 suffix", () => {
    const apiRoutes = [
      ["app", "api", "orders", "[id]", "route.ts"],
      ["app", "api", "orders", "[id]", "content", "route.ts"],
      ["app", "api", "orders", "[id]", "details", "route.ts"],
      ["app", "api", "orders", "[id]", "management", "route.ts"],
      ["app", "api", "orders", "[id]", "notification", "route.ts"],
      ["app", "api", "orders", "[id]", "client", "route.ts"],
    ];

    for (const parts of apiRoutes) {
      const source = read(...parts);
      // Extract all .rpc("...") calls
      const rpcCalls = [...source.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]);
      for (const rpcName of rpcCalls) {
        // Allowed: *_v2 variants, archive_order, kiosk_*, or system RPCs
        const isAllowed =
          rpcName.endsWith("_v2") ||
          rpcName === "archive_order" ||
          rpcName.startsWith("kiosk_");
        assert.ok(
          isAllowed,
          `${parts.join("/")} calls RPC "${rpcName}" which is not a _v2 or allowed exception`,
        );
      }
    }
  });

  it("archive_order has no expected_version parameter (no v2 variant)", () => {
    // archive route must use archive_order (not archive_order_v2)
    const archiveRoute = read("app", "api", "orders", "[id]", "archive", "route.ts");
    assert.match(archiveRoute, /rpc\(\s*["']archive_order["']/);
    assert.equal(archiveRoute.includes("archive_order_v2"), false);
    assert.equal(archiveRoute.includes("expected_version"), false);
  });

  it("no silent fallback to v1 via try/catch swallowing stale errors", () => {
    // Stale errors (GCO01 / ORDER_STALE) must surface, never be silently caught
    // and retried with a v1 call.
    const workspace = read("components", "orders", "detail", "order-workspace.tsx");
    // Must NOT contain a pattern like: catch(...){ .rpc("change_order_content" }
    for (const v1Name of v1RpcNames) {
      const catchFallbackPattern = new RegExp(
        `catch[^{]*\\{[^}]*\\.rpc\\(["'\`]${v1Name}["'\`]`,
        "s",
      );
      assert.equal(
        catchFallbackPattern.test(workspace),
        false,
        `OrderWorkspace has a catch block that silently falls back to v1 RPC "${v1Name}"`,
      );
    }
  });
});
