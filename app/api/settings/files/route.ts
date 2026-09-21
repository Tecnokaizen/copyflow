import { NextRequest, NextResponse } from "next/server";
import {
  canManageFilesSettings,
  parseMaxFileBytes,
  parseTenantFilesSettings,
} from "@/lib/settings/files";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const ACCESS_DENIED = "Unauthorized or tenant access denied";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function GET() {
  const context = await getCurrentContext();

  if (!context || !canManageFilesSettings(context.membership.role)) {
    return json({ error: ACCESS_DENIED }, 403);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_tenant_files_settings", {
    p_tenant_id: context.tenant.id,
  });

  if (error) {
    console.error("[GET /api/settings/files] rpc failed", {
      message: error.message,
    });
    return json({ error: "Could not load files settings" }, 500);
  }

  const parsed = parseTenantFilesSettings(data);
  if (!parsed) {
    return json({ error: "Could not load files settings" }, 500);
  }

  return json({
    tenant: context.tenant.slug,
    ...parsed,
  });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentContext();

  if (!context || !canManageFilesSettings(context.membership.role)) {
    return json({ error: ACCESS_DENIED }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const maxFileBytes = parseMaxFileBytes(
    (body as Record<string, unknown>).max_file_bytes
  );
  if (maxFileBytes === null) {
    return json({ error: "Invalid max_file_bytes" }, 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "update_tenant_files_max_file_bytes",
    {
      p_tenant_id: context.tenant.id,
      p_max_file_bytes: maxFileBytes,
    }
  );

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("invalid_max_file_bytes")) {
      return json({ error: "Invalid max_file_bytes" }, 400);
    }
    if (
      message.includes("tenant access denied") ||
      error.code === "42501"
    ) {
      return json({ error: ACCESS_DENIED }, 403);
    }
    console.error("[PATCH /api/settings/files] rpc failed", {
      message: error.message,
    });
    return json({ error: "Could not update files settings" }, 500);
  }

  const parsed = parseTenantFilesSettings(data);
  if (!parsed) {
    return json({ error: "Could not update files settings" }, 500);
  }

  return json({
    ok: true,
    tenant: context.tenant.slug,
    ...parsed,
  });
}
