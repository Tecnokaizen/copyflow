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

const ROUTE = "POST /api/imports/clients/batches/[id]/commit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCurrentAccess(ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const body = await readJsonBody(request);
  if (!body || !Number.isInteger(body.expected_version)) {
    return invalidBody();
  }
  const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit as number, 1), 500) : 200;

  const { data, error } = await supabase.rpc("client_import_commit_chunk", { p_batch_id: id, p_expected_version: body.expected_version, p_limit: limit });
  if (error) return clientImportRpcError(ROUTE, access.context, error);
  return operationalJson({ batch: data });
}
