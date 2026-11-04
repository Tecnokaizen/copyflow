import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { mapOrderCollection, withActorNames } from "@/lib/orders/collection";
import {
  ORDER_ITEMS_ORDER_SELECT,
  ORDER_ITEMS_SELECT,
  mapOrderItemsState,
  mapReplaceItemsResult,
  orderItemsError,
  parseOrderItemsPayload,
} from "@/lib/orders/items";
import { loadProfileNames } from "@/lib/orders/profile-names";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { getCurrentContext } from "@/lib/tenant/current-context";

type RouteContext = { params: Promise<{ id: string }> };

/** Saved lines and the order's total mode (lines are readable by any member). */
export async function GET(_request: NextRequest, context: RouteContext) {
  const current = await getCurrentContext();
  if (!current) {
    return operationalJson({ error: "Unauthorized or tenant access denied" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase.from("orders")
    .select(ORDER_ITEMS_ORDER_SELECT).eq("id", id).eq("tenant_id", current.tenant.id).maybeSingle();
  if (orderError) return operationalJson({ error: "No se pudieron cargar las partidas" }, { status: 500 });
  if (!order) return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  const { data: rows, error } = await supabase.from("order_items")
    .select(ORDER_ITEMS_SELECT).eq("order_id", id).eq("tenant_id", current.tenant.id).order("position");
  if (error) return operationalJson({ error: "No se pudieron cargar las partidas" }, { status: 500 });
  const state = mapOrderItemsState(order, rows);
  if (!state) return operationalJson({ error: "No se pudieron cargar las partidas" }, { status: 500 });
  return operationalJson(state);
}

/**
 * Saves the lines and makes them the source of the order total (items mode).
 * The database computes every amount and refuses a total below what was paid.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const current = await getCurrentContext();
  if (!current) {
    return operationalJson({ error: "Unauthorized or tenant access denied" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return operationalJson({ error: orderItemsError("invalid_items").error }, { status: 422 });
  }
  const parsed = parseOrderItemsPayload(body);
  if (!parsed.ok) {
    if (parsed.error === "conflict") {
      return operationalJson({ code: "conflict", error: orderItemsError("conflict").error }, { status: 409 });
    }
    return operationalJson({ error: parsed.error, ...(parsed.index === undefined ? {} : { index: parsed.index }) }, { status: 422 });
  }
  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase.from("orders")
    .select("id").eq("id", id).eq("tenant_id", current.tenant.id).maybeSingle();
  if (orderError) return operationalJson({ error: orderItemsError(null).error }, { status: 500 });
  if (!order) return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });

  const { data, error } = await supabase.rpc("replace_order_items_v1", {
    p_order_id: id,
    p_expected_row_version: parsed.data.expected_version,
    p_items: parsed.data.items,
    p_total_mode: "items",
    p_prices_include_tax: parsed.data.prices_include_tax,
  });
  if (error) return operationalJson({ error: orderItemsError(null).error }, { status: 500 });
  const payload = data as { ok?: boolean; error?: string; index?: number };
  if (!payload?.ok) {
    const mapped = orderItemsError(payload?.error);
    return operationalJson({
      error: mapped.error,
      ...(payload?.error === "conflict" ? { code: "conflict" } : {}),
      ...(typeof payload?.index === "number" ? { index: payload.index } : {}),
    }, { status: mapped.status });
  }
  const items = mapReplaceItemsResult(data);
  const collection = mapOrderCollection(data);
  if (!items || !collection) return operationalJson({ error: orderItemsError(null).error }, { status: 500 });
  return operationalJson({
    items,
    collection: await withActorNames(collection, (ids) => loadProfileNames(supabase, ids)),
  });
}
