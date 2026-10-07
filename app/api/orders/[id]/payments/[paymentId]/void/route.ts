import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { collectionError, mapOrderCollection, withActorNames } from "@/lib/orders/collection";
import { loadProfileNames } from "@/lib/orders/profile-names";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { getCurrentContext } from "@/lib/tenant/current-context";

type RouteContext = { params: Promise<{ id: string; paymentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const current = await getCurrentContext();
  if (!current) {
    return operationalJson({ error: "Unauthorized or tenant access denied" }, { status: 403 });
  }
  const { id, paymentId } = await context.params;
  if (!isUuid(id) || !isUuid(paymentId)) {
    return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return operationalJson({ error: "Indica el motivo de la anulación." }, { status: 422 });
  }
  const reason = body && typeof body === "object" && typeof (body as { reason?: unknown }).reason === "string"
    ? (body as { reason: string }).reason.trim()
    : "";
  if (reason.length < 1 || reason.length > 500) {
    return operationalJson({ error: "Indica el motivo de la anulación." }, { status: 422 });
  }
  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", current.tenant.id)
    .maybeSingle();
  if (orderError || !order) {
    return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("void_order_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  if (error) {
    return operationalJson({ error: "No se pudo anular la entrega" }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string };
  if (!payload?.ok) {
    const mapped = collectionError(payload.error);
    return operationalJson({ error: mapped.error }, { status: mapped.status });
  }
  const collection = mapOrderCollection(data);
  if (!collection) {
    return operationalJson({ error: "No se pudo anular la entrega" }, { status: 500 });
  }
  return operationalJson(await withActorNames(collection, (ids) => loadProfileNames(supabase, ids)));
}
