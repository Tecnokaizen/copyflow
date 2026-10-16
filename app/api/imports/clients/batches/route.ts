import { NextRequest } from "next/server";

import { operationalJson } from "@/lib/http/operational-cache";
import {
  clientImportForbidden,
  clientImportRpcError,
  invalidBody,
  readJsonBody,
} from "@/lib/imports/clients/http";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

const LIST_ROUTE = "GET /api/imports/clients/batches";
const CREATE_ROUTE = "POST /api/imports/clients/batches";

export async function GET() {
  const access = await requireCurrentAccess(LIST_ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const { data, error } = await supabase.rpc("client_import_list_batches", {
    p_tenant_id: access.context.tenant.id,
    p_limit: 20,
  });
  if (error) return clientImportRpcError(LIST_ROUTE, access.context, error);
  return operationalJson({ batches: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAccess(CREATE_ROUTE);
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  if (forbidden) return forbidden;

  const body = await readJsonBody(request);
  if (
    !body ||
    typeof body.source_system !== "string" ||
    typeof body.file_name !== "string" ||
    typeof body.file_size !== "number" ||
    typeof body.file_sha256 !== "string" ||
    !body.mapping ||
    typeof body.mapping !== "object" ||
    Array.isArray(body.mapping)
  ) {
    return invalidBody();
  }

  const { data, error } = await supabase.rpc("client_import_create_batch", {
    p_tenant_id: access.context.tenant.id,
    p_source_system: body.source_system,
    p_file_name: body.file_name,
    p_file_size: body.file_size,
    p_file_sha256: body.file_sha256,
    p_mapping: body.mapping,
  });
  if (error) return clientImportRpcError(CREATE_ROUTE, access.context, error);
  return operationalJson({ batch: data });
}
