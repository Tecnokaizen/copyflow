import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import {
  clientImportForbidden,
  clientImportRpcError,
  isUuid,
  notFound,
  readJsonBody,
} from "@/lib/imports/clients/http";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "POST /api/imports/clients/batches/[id]/revert";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = await readJsonBody(request);
  const limit = Number.isInteger(body?.limit) ? Math.min(Math.max(body?.limit as number, 1), 2000) : 500;

  const { data, error } = await supabase.rpc("client_import_revert", { p_batch_id: id, p_limit: limit });
  if (error) return clientImportRpcError(ROUTE, access.context, error);
  return operationalJson({ batch: data });
}
