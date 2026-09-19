import { NextRequest, NextResponse } from "next/server";
import {
  toPublicOrderFileDto,
  type PublicTenantFileListItem,
} from "@/lib/files/dto";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePage(raw: string | null) {
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function parsePageSize(raw: string | null) {
  if (!raw) return 25;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, 100);
}

function parseOptionalText(raw: string | null) {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function parseUuid(
  raw: string | null
): { ok: true; value: string | null } | { ok: false } {
  const value = parseOptionalText(raw);
  if (!value) return { ok: true, value: null };
  if (!UUID_PATTERN.test(value)) return { ok: false };
  return { ok: true, value };
}

function parseTimestamp(
  raw: string | null
): { ok: true; value: string | null } | { ok: false } {
  const value = parseOptionalText(raw);
  if (!value) return { ok: true, value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

type FileRow = {
  id: string;
  original_name: string;
  content_type: string | null;
  size_bytes: number | string;
  status: string;
  created_at: string;
  completed_at: string | null;
  uploaded_by: string | null;
  order_id: string;
  orders:
    | {
        id: string;
        reference: string | null;
        title: string;
        archived_at: string | null;
        client_id: string | null;
        clients:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }
    | {
        id: string;
        reference: string | null;
        title: string;
        archived_at: string | null;
        client_id: string | null;
        clients:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }[]
    | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(request: NextRequest) {
  const context = await getCurrentContext();
  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized or tenant access denied" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const orderId = parseUuid(params.get("order_id"));
  const from = parseTimestamp(params.get("from"));
  const to = parseTimestamp(params.get("to"));
  if (!orderId.ok || !from.ok || !to.ok) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const q = parseOptionalText(params.get("q"));
  const status = parseOptionalText(params.get("status"));
  const contentType = parseOptionalText(params.get("content_type"));
  if (status && status !== "pending" && status !== "ready") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const page = parsePage(params.get("page"));
  const pageSize = parsePageSize(params.get("page_size"));
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const supabase = await createClient();

  let query = supabase
    .from("order_files")
    .select(
      `
      id,
      original_name,
      content_type,
      size_bytes,
      status,
      created_at,
      completed_at,
      uploaded_by,
      order_id,
      orders!inner (
        id,
        reference,
        title,
        archived_at,
        client_id,
        clients (
          id,
          name
        )
      )
    `,
      { count: "exact" }
    )
    .eq("tenant_id", context.tenant.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(fromIdx, toIdx);

  if (orderId.value) {
    query = query.eq("order_id", orderId.value);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (contentType) {
    query = query.ilike("content_type", contentType);
  }
  if (from.value) {
    query = query.gte("created_at", from.value);
  }
  if (to.value) {
    query = query.lte("created_at", to.value);
  }
  if (q) {
    const escaped = q.replace(/[%_]/g, "\\$&");
    query = query.ilike("original_name", `%${escaped}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[GET /api/files] list failed", { message: error.message });
    return NextResponse.json({ error: "Could not list files" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as FileRow[];
  const uploaderIds = [
    ...new Set(
      rows
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

  const files: PublicTenantFileListItem[] = rows.map((row) => {
    const order = unwrapOne(row.orders);
    const client = unwrapOne(order?.clients ?? null);
    const fileDto = toPublicOrderFileDto(
      row as unknown as Record<string, unknown>,
      row.uploaded_by ? nameByUser.get(row.uploaded_by) ?? null : null
    );
    return {
      ...fileDto,
      order: {
        id: String(order?.id ?? row.order_id),
        reference: String(order?.reference ?? ""),
        title: String(order?.title ?? ""),
        archived_at:
          typeof order?.archived_at === "string" ? order.archived_at : null,
      },
      client: client
        ? { id: String(client.id), name: String(client.name) }
        : null,
    };
  });

  const total = count ?? files.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return NextResponse.json({
    tenant: context.tenant.slug,
    files,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    has_more: page < totalPages,
  });
}
