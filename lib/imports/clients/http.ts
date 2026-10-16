import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";

import { hasMembershipRole, MANAGEMENT_ROLES } from "@/lib/auth/membership-roles";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { operationalJson } from "@/lib/http/operational-cache";
import type { AccessContext } from "@/lib/tenant/access";

import { CLIENT_IMPORT_FEATURE_CODE } from "./feature";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

/**
 * Role + feature gate for every client import route, after requireCurrentAccess.
 * The RPCs repeat both checks; this answers early with a clear status.
 */
export async function clientImportForbidden(
  context: AccessContext,
  supabase: SupabaseClient,
): Promise<NextResponse | null> {
  if (!hasMembershipRole(context.membership.role, MANAGEMENT_ROLES)) {
    return operationalJson(
      { error: "Solo owner, admin y manager pueden importar clientes.", code: "role_denied" },
      { status: 403 },
    );
  }
  if (!(await tenantHasFeature(supabase, context.tenant.id, CLIENT_IMPORT_FEATURE_CODE))) {
    return operationalJson(
      { error: "La importación de clientes no está activada para esta copistería.", code: "feature_disabled" },
      { status: 404 },
    );
  }
  return null;
}

const RPC_ERRORS: Record<string, { status: number; code: string; error: string }> = {
  "28000": { status: 401, code: "SESSION_EXPIRED", error: "Tu sesión ha caducado. Vuelve a iniciar sesión." },
  "42501": { status: 403, code: "forbidden", error: "No tienes permiso para esta importación." },
  P0002: { status: 404, code: "not_found", error: "No se encuentra esta importación." },
  "22023": { status: 400, code: "invalid", error: "Los datos enviados no son válidos." },
  "55000": { status: 409, code: "batch_state", error: "La importación ya no admite este paso." },
  GC409: { status: 409, code: "row_version_conflict", error: "La importación ha cambiado. Recarga el estado y vuelve a intentarlo." },
  GC422: {
    status: 409,
    code: "batch_incomplete",
    error: "A esta importación le faltan filas del archivo. Vuelve a elegir el archivo original, con las mismas columnas, para completarla.",
  },
  "54000": { status: 429, code: "too_many_open_batches", error: "Hay demasiadas importaciones abiertas. Termina o cancela alguna." },
};

export function clientImportRpcError(route: string, context: AccessContext, error: PostgrestError): NextResponse {
  const mapped =
    error.code === "42501" && error.message === "clients_import_disabled"
      ? { status: 404, code: "feature_disabled", error: "La importación de clientes no está activada para esta copistería." }
      : RPC_ERRORS[error.code] ?? { status: 500, code: "import_failed", error: "No se ha podido completar la operación." };

  if (mapped.status >= 500) {
    console.error(`[${route}] client import rpc failed`, {
      tenantId: context.tenant.id,
      userId: context.user.id,
      code: error.code,
      message: error.message,
    });
  }
  return operationalJson(
    { error: mapped.error, code: mapped.code, detail: error.code === "22023" ? error.message : undefined },
    { status: mapped.status },
  );
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const invalidBody = () =>
  operationalJson({ error: "Los datos enviados no son válidos.", code: "invalid" }, { status: 400 });

export const notFound = () =>
  operationalJson({ error: "No se encuentra esta importación.", code: "not_found" }, { status: 404 });
