/** Explicit public order fields. Never spread select * into API responses. */
export const PUBLIC_ORDER_SCALAR_KEYS = [
  "id",
  "reference",
  "title",
  "description",
  "priority",
  "due_at",
  "received_at",
  "ready_at",
  "delivered_at",
  "archived_at",
  "customer_notification_status",
  "customer_notified_at",
  "customer_notified_by",
  "notes",
  "client_id",
  "status_id",
  "service_id",
  "entry_channel_id",
  "assigned_team_member_id",
  "order_context_id",
  "store_id",
  "file_status_id",
  "quote_status_id",
  "payment_status_id",
  "delivery_method_id",
  "external_folder_url",
] as const;

export const PUBLIC_ORDER_RELATION_KEYS = [
  "client",
  "service",
  "status",
  "entry_channel",
  "assigned_team_member",
  "order_context",
  "store",
  "file_status",
  "quote_status",
  "payment_status",
  "delivery_method",
] as const;

const FORBIDDEN_ORDER_KEYS = new Set([
  "row_version",
  "metadata",
  "requirements_override",
  "created_by",
]);

export function toPublicOrderDto<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = {};

  for (const key of PUBLIC_ORDER_SCALAR_KEYS) {
    if (key in row) {
      out[key] = row[key];
    }
  }
  for (const key of PUBLIC_ORDER_RELATION_KEYS) {
    if (key in row) {
      out[key] = row[key];
    }
  }

  const rowVersion = row.row_version;
  out.version = String(rowVersion);

  for (const forbidden of FORBIDDEN_ORDER_KEYS) {
    delete out[forbidden];
  }

  return out;
}

export type PublicOrderFileDto = {
  id: string;
  original_name: string;
  content_type: string | null;
  size_bytes: number;
  status: "pending" | "ready";
  created_at: string;
  completed_at: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
};

export function toPublicOrderFileDto(
  row: Record<string, unknown>,
  uploaderName: string | null = null
): PublicOrderFileDto {
  const sizeRaw = row.size_bytes;
  const sizeBytes =
    typeof sizeRaw === "number"
      ? sizeRaw
      : typeof sizeRaw === "string"
        ? Number(sizeRaw)
        : 0;

  return {
    id: String(row.id),
    original_name: String(row.original_name ?? "archivo"),
    content_type:
      typeof row.content_type === "string" ? row.content_type : null,
    size_bytes: sizeBytes,
    status: row.status === "ready" ? "ready" : "pending",
    created_at: String(row.created_at ?? ""),
    completed_at:
      typeof row.completed_at === "string" ? row.completed_at : null,
    uploaded_by:
      typeof row.uploaded_by === "string" ? row.uploaded_by : null,
    uploader_name: uploaderName,
  };
}

export type PublicTenantFileListItem = PublicOrderFileDto & {
  order: {
    id: string;
    reference: string;
    title: string;
    archived_at: string | null;
  };
  client: {
    id: string;
    name: string;
  } | null;
};
