import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { assertCanMutateOrderFiles } from "@/lib/files/access";
import {
  createFilesCapability,
  filesCapabilityIssuedAtNow,
  requireFilesSigningSecret,
} from "@/lib/files/capability";
import { toPublicOrderFileDto } from "@/lib/files/dto";
import {
  PUT_PRESIGN_TTL_SECONDS,
  validateOrderFileInit,
} from "@/lib/files/validation";
import { mapOrderFileRpcError } from "@/lib/files/rpc-error";
import { resolveMaxFileBytesFromPreferences } from "@/lib/settings/files";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { presignPut } from "@/lib/storage/r2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrderForTenant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  tenantId: string
) {
  return supabase
    .from("orders")
    .select("id, tenant_id, archived_at, reference, title")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id: orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: order, error: orderError } = await loadOrderForTenant(
    supabase,
    orderId,
    context.tenant.id
  );
  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: files, error } = await supabase
    .from("order_files")
    .select(
      "id, original_name, content_type, size_bytes, status, created_at, completed_at, uploaded_by"
    )
    .eq("tenant_id", context.tenant.id)
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/orders/:id/files] list failed", {
      message: error.message,
    });
    return NextResponse.json({ error: "Could not list files" }, { status: 500 });
  }

  const { data: settingsRow } = await supabase
    .from("tenant_settings")
    .select("preferences")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();

  const maxFileBytes = resolveMaxFileBytesFromPreferences(
    settingsRow?.preferences
  );

  const uploaderIds = [
    ...new Set(
      (files ?? [])
        .map((row) => row.uploaded_by)
        .filter((id): id is string => typeof id === "string")
    ),
  ];

  const nameByUser = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uploaderIds);
    for (const profile of profiles ?? []) {
      if (
        typeof profile.id === "string" &&
        typeof profile.full_name === "string" &&
        profile.full_name.trim()
      ) {
        nameByUser.set(profile.id, profile.full_name.trim());
      }
    }
  }

  return NextResponse.json({
    tenant: context.tenant.slug,
    order_id: orderId,
    max_file_bytes: maxFileBytes,
    files: (files ?? []).map((row) =>
      toPublicOrderFileDto(
        row as Record<string, unknown>,
        typeof row.uploaded_by === "string"
          ? nameByUser.get(row.uploaded_by) ?? null
          : null
      )
    ),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const { id: orderId } = await params;
  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;

  const supabase = await createClient();
  const { data: order, error: orderError } = await loadOrderForTenant(
    supabase,
    orderId,
    context.tenant.id
  );
  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const mutate = assertCanMutateOrderFiles({
    role: context.membership.role,
    archivedAt: order.archived_at,
  });
  if (!mutate.ok) {
    return NextResponse.json(mutate.body, { status: mutate.status });
  }

  const { data: settingsRow } = await supabase
    .from("tenant_settings")
    .select("preferences")
    .eq("tenant_id", context.tenant.id)
    .maybeSingle();
  const maxFileBytes = resolveMaxFileBytesFromPreferences(
    settingsRow?.preferences
  );

  const validated = validateOrderFileInit({
    filename: record.filename,
    content_type: record.content_type,
    size_bytes: record.size_bytes,
    max_file_bytes: maxFileBytes,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  let signingSecret: string;
  try {
    signingSecret = requireFilesSigningSecret();
  } catch {
    console.error("[POST /api/orders/:id/files] FILES_SIGNING_SECRET missing");
    return NextResponse.json(
      { error: "Could not create file" },
      { status: 500 }
    );
  }

  const fileId = randomUUID();
  const expiresAt = new Date(Date.now() + PUT_PRESIGN_TTL_SECONDS * 1000);
  const issuedAt = filesCapabilityIssuedAtNow();
  const capability = createFilesCapability(
    {
      purpose: "create",
      userId: context.user.id,
      tenantId: context.tenant.id,
      orderId,
      fileId,
      issuedAt,
    },
    signingSecret
  );

  const { data: created, error: createError } = await supabase.rpc(
    "create_order_file_upload",
    {
      p_order_id: orderId,
      p_file_id: fileId,
      p_original_name: validated.filename,
      p_content_type: validated.contentType,
      p_size_bytes: validated.sizeBytes,
      p_upload_expires_at: expiresAt.toISOString(),
      p_issued_at: capability.issuedAt,
      p_signature: capability.signature,
    }
  );

  if (createError || !created) {
    console.error("[POST /api/orders/:id/files] create_order_file_upload failed", {
      message: createError?.message,
    });
    const mapped = mapOrderFileRpcError(createError, "Could not create file");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const payload = created as {
    storage_key?: unknown;
    upload_expires_at?: unknown;
  };
  const storageKey =
    typeof payload.storage_key === "string" ? payload.storage_key : null;
  if (!storageKey) {
    return NextResponse.json({ error: "Could not create file" }, { status: 500 });
  }

  let uploadUrl: string;
  try {
    uploadUrl = await presignPut({
      key: storageKey,
      contentType: validated.contentType,
      expiresIn: PUT_PRESIGN_TTL_SECONDS,
    });
  } catch (error) {
    console.error("[POST /api/orders/:id/files] presign failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not create upload URL" },
      { status: 500 }
    );
  }

  const requiredHeaders: Record<string, string> = {};
  if (validated.contentType) {
    requiredHeaders["Content-Type"] = validated.contentType;
  }

  const expires =
    typeof payload.upload_expires_at === "string"
      ? payload.upload_expires_at
      : expiresAt.toISOString();

  return NextResponse.json(
    {
      file_id: fileId,
      upload_url: uploadUrl,
      required_headers: requiredHeaders,
      expires_at: expires,
    },
    { status: 201 }
  );
}
