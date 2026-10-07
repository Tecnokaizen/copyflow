import { NextRequest } from "next/server";
import { operationalJson } from "@/lib/http/operational-cache";
import { collectionError, mapOrderCollection, withActorNames } from "@/lib/orders/collection";
import { loadProfileNames } from "@/lib/orders/profile-names";
import { canonicalMoney } from "@/lib/orders/money";
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
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const amount = typeof record?.amount === "string" ? canonicalMoney(record.amount, false) : null;
  const paidAt = typeof record?.paid_at === "string" ? record.paid_at : null;
  const key = typeof record?.idempotency_key === "string" ? record.idempotency_key : null;
  if (!amount || !paidAt || !key || !/^[A-Za-z0-9:_-]{8,80}$/.test(key)) {
    return operationalJson({ error: "El importe no es válido." }, { status: 422 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_order_payment", {
    p_order_id: id,
    p_amount: amount,
    p_paid_at: paidAt,
    p_idempotency_key: key,
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
