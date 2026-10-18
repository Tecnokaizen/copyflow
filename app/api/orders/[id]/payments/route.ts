import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { collectionError, mapOrderCollection, withActorNames } from "@/lib/orders/collection";
import { loadProfileNames } from "@/lib/orders/profile-names";
import { parsePaymentPayload } from "@/lib/orders/payment-payload";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/team/payload";
import { getCurrentContext } from "@/lib/tenant/current-context";

type RouteContext = { params: Promise<{ id: string }> };

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
    .select("id").eq("id", id).eq("tenant_id", current.tenant.id).maybeSingle();
  if (orderError) return operationalJson({ error: "No se pudo comprobar el pedido" }, { status: 500 });
  if (!order) return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  const { data, error } = await supabase.rpc("order_collection_v1", { p_order_id: id });
  if (error) {
    return operationalJson({ error: "No se pudo cargar el cobro" }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string };
  if (!payload?.ok) {
    const mapped = collectionError(payload?.error);
    return operationalJson({ error: mapped.error }, { status: mapped.status });
  }
  const collection = mapOrderCollection(data);
  if (!collection) {
    return operationalJson({ error: "No se pudo cargar el cobro" }, { status: 500 });
  }
  return operationalJson(await withActorNames(collection, (ids) => loadProfileNames(supabase, ids)));
}

export async function POST(request: NextRequest, context: RouteContext) {
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
  const payment = parsePaymentPayload(body);
  if (!payment) {
    return operationalJson({ error: "Revisa el importe, la fecha, el método de pago y el justificante." }, { status: 422 });
  }
  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase.from("orders")
    .select("id").eq("id", id).eq("tenant_id", current.tenant.id).maybeSingle();
  if (orderError) return operationalJson({ error: "No se pudo comprobar el pedido" }, { status: 500 });
  if (!order) return operationalJson({ error: "No se encontró el pedido" }, { status: 404 });
  const { data, error } = await supabase.rpc("record_order_payment", {
    p_order_id: id,
    p_amount: payment.amount,
    p_paid_at: payment.paid_at,
    p_idempotency_key: payment.idempotency_key,
    p_payment_method: payment.payment_method,
    p_receipt_file_id: payment.receipt_file_id,
    p_tenant_id: current.tenant.id,
  });
  if (error) {
    return operationalJson({ error: "No se pudo registrar la entrega" }, { status: 500 });
  }
  const payload = data as { ok?: boolean; error?: string };
  if (!payload?.ok) {
    const mapped = collectionError(payload?.error);
    return operationalJson({ error: mapped.error }, { status: mapped.status });
  }
  const collection = mapOrderCollection(data);
  if (!collection) {
    return operationalJson({ error: "No se pudo registrar la entrega" }, { status: 500 });
  }
  return operationalJson(await withActorNames(collection, (ids) => loadProfileNames(supabase, ids)));
}
