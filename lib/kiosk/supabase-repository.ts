import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KioskOrderInsert,
  KioskRepository,
  KioskService,
  KioskTenant,
} from "./service";

export function mapKioskTenantRow(row: unknown): KioskTenant | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string" ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    active: value.active,
  };
}

export function mapKioskServiceRow(row: unknown): KioskService | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    tenantId: value.tenant_id,
    name: value.name,
    active: value.active,
  };
}

export function mapKioskOrderRow(row: unknown) {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.reference !== "string"
  ) {
    return null;
  }
  const metadata =
    value.metadata && typeof value.metadata === "object"
      ? (value.metadata as Record<string, unknown>)
      : null;
  return {
    id: value.id,
    tenantId: value.tenant_id,
    reference: value.reference,
    source: typeof metadata?.source === "string" ? metadata.source : null,
  };
}

function throwIfError(error: unknown) {
  if (error) throw error;
}

export function createSupabaseKioskRepository(
  supabase: SupabaseClient
): KioskRepository {
  return {
    async findTenantBySlug(slug) {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, slug, active")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      throwIfError(error);
      return mapKioskTenantRow(data);
    },

    async listActiveServices(tenantId) {
      const { data, error } = await supabase
        .from("services")
        .select("id, tenant_id, name, active")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      throwIfError(error);
      return (data ?? [])
        .map(mapKioskServiceRow)
        .filter((service): service is KioskService => service !== null);
    },

    async findActiveService(tenantId, serviceId) {
      const { data, error } = await supabase
        .from("services")
        .select("id, tenant_id, name, active")
        .eq("tenant_id", tenantId)
        .eq("id", serviceId)
        .eq("active", true)
        .maybeSingle();
      throwIfError(error);
      return mapKioskServiceRow(data);
    },

    async listInitialStatuses(tenantId) {
      const { data, error } = await supabase
        .from("order_statuses")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq("is_initial", true)
        .limit(2);
      throwIfError(error);
      return (data ?? []).filter(
        (row): row is { id: string } => typeof row.id === "string"
      );
    },

    async listKioskChannels(tenantId) {
      const { data, error } = await supabase
        .from("entry_channels")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq("code", "kiosk")
        .limit(2);
      throwIfError(error);
      return (data ?? []).filter(
        (row): row is { id: string } => typeof row.id === "string"
      );
    },

    async findOrderById(id) {
      const { data, error } = await supabase
        .from("orders")
        .select("id, tenant_id, reference, metadata")
        .eq("id", id)
        .maybeSingle();
      throwIfError(error);
      return mapKioskOrderRow(data);
    },

    async insertOrder(order: KioskOrderInsert) {
      const { data, error } = await supabase
        .from("orders")
        .insert(order)
        .select("reference")
        .single();
      throwIfError(error);
      if (!data || typeof data.reference !== "string") {
        throw new Error("Kiosk order insert returned no reference");
      }
      return { reference: data.reference };
    },
  };
}
