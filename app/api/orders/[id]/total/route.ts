import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { collectionError, mapOrderCollection, withActorNames } from "@/lib/orders/collection";
import { loadProfileNames } from "@/lib/orders/profile-names";
import { canonicalMoney } from "@/lib/orders/money";
import { parseExpectedVersion } from "@/lib/orders/concurrency";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { getCurrentContext } from "@/lib/tenant/current-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    return operationalJson({ error: "El importe no es válido." }, { status: 422 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const version = parseExpectedVersion(record?.expected_version);
  if (!version) {
    return operationalJson({ error: "El pedido cambió. Recarga la ficha e inténtalo de nuevo." }, { status: 409 });
  }
  let total: string | null;
  if (record?.total_amount == null) {
    total = null;
  } else if (typeof record.total_amount === "string") {
    total = canonicalMoney(record.total_amount, true);
    if (!total) {
      return operationalJson({ error: "El importe no es válido." }, { status: 422 });
    }
  } else {
    return operationalJson({ error: "El importe no es válido." }, { status: 422 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_order_total_amount", {
    p_order_id: id,
    p_total: total,
    p_expected_row_version: version,
  });
  if (error) {
    return operationalJson({ error: "No se pudo guardar el total" }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string };
  if (!payload?.ok) {
    const mapped = collectionError(payload.error);
    return operationalJson({ error: mapped.error }, { status: mapped.status });
  }
  const collection = mapOrderCollection(data);
  if (!collection) {
    return operationalJson({ error: "No se pudo guardar el total" }, { status: 500 });
  }
  return operationalJson(await withActorNames(collection, (ids) => loadProfileNames(supabase, ids)));
}
