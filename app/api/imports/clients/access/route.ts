import { operationalJson } from "@/lib/http/operational-cache";
import { clientImportForbidden } from "@/lib/imports/clients/http";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentAccess } from "@/lib/tenant/access-response";

/** Whether the current user may open Clientes → Importar (role + clients_import feature). */
export async function GET() {
  const access = await requireCurrentAccess("GET /api/imports/clients/access");
  if (!access.ok) return access.response;
  const supabase = await createClient();
  const forbidden = await clientImportForbidden(access.context, supabase);
  return operationalJson({ allowed: forbidden === null });
}
