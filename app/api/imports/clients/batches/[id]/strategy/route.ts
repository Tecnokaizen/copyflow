import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import {
  clientImportForbidden,
  clientImportRpcError,
  invalidBody,
  isUuid,
  notFound,
  readJsonBody,
} from "@/lib/imports/clients/http";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const ROUTE = "POST /api/imports/clients/batches/[id]/strategy";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJsonBody(request);
  if (!body || (body.strategy !== "skip" && body.strategy !== "fill_blanks")) {
    return invalidBody();
  }

  const { data, error } = await supabase.rpc("client_import_set_strategy", { p_batch_id: id, p_strategy: body.strategy, p_confirm: body.confirm === true });
  if (error) return clientImportRpcError(ROUTE, access.context, error);
  return operationalJson({ batch: data });
}
