import { createHash } from "node:crypto";
import { deriveOrderTitle } from "@/lib/orders/create";
import {
  buildKioskOrderNotes,
  type KioskOrderInput,
} from "./payload";

export type KioskTenant = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
};

export type KioskService = {
  id: string;
  name: string;
  tenantId: string;
  active: boolean;
};

export type KioskOrderInsert = {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  service_id: string;
  status_id: string;
  entry_channel_id: string;
  priority: "normal";
  due_at: string | null;
  notes: string;
  metadata: {
    source: "kiosk";
    kiosk: {
      submission_id: string;
      request_fingerprint: string;
      contact: KioskOrderInput["contact"];
    };
  };
  created_by: null;
};

export type KioskRepository = {
  findTenantBySlug(slug: string): Promise<KioskTenant | null>;
  listActiveServices(tenantId: string): Promise<KioskService[]>;
  findActiveService(
    tenantId: string,
    serviceId: string
  ): Promise<KioskService | null>;
  listInitialStatuses(tenantId: string): Promise<Array<{ id: string }>>;
  listKioskChannels(tenantId: string): Promise<Array<{ id: string }>>;
  findOrderById(tenantId: string, id: string): Promise<{
    id: string;
    tenantId: string;
    source: string | null;
    fingerprint: string | null;
    reference: string;
  } | null>;
  insertOrder(order: KioskOrderInsert): Promise<{ reference: string }>;
};

export type KioskBootstrapDto = {
  tenant: { name: string };
  services: Array<{ id: string; name: string }>;
};

export class KioskServiceError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "invalid_configuration"
      | "could_not_create",
    public readonly status: number
  ) {
    super(code);
    this.name = "KioskServiceError";
  }
}

export function kioskInputFingerprint(input: KioskOrderInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        contact: input.contact,
        serviceId: input.serviceId,
        description: input.description,
        dueAt: input.dueAt,
        observations: input.observations,
      })
    )
    .digest("hex");
}

async function activeTenant(
  slug: string | null,
  repository: KioskRepository
) {
  if (!slug) return null;
  const tenant = await repository.findTenantBySlug(slug);
  return tenant?.active ? tenant : null;
}

export async function getKioskBootstrap(
  slug: string | null,
  repository: KioskRepository
): Promise<KioskBootstrapDto | null> {
  const tenant = await activeTenant(slug, repository);
  if (!tenant) return null;

  const [services, statuses, channels] = await Promise.all([
    repository.listActiveServices(tenant.id),
    repository.listInitialStatuses(tenant.id),
    repository.listKioskChannels(tenant.id),
  ]);
  if (services.length === 0 || statuses.length !== 1 || channels.length !== 1) {
    return null;
  }
  return {
    tenant: { name: tenant.name },
    services: services
      .filter(
        (service) => service.active && service.tenantId === tenant.id
      )
      .map(({ id, name }) => ({ id, name })),
  };
}

export async function submitKioskOrder(
  slug: string | null,
  input: KioskOrderInput,
  repository: KioskRepository
) {
  const tenant = await activeTenant(slug, repository);
  if (!tenant) {
    throw new KioskServiceError("not_found", 404);
  }

  const fingerprint = kioskInputFingerprint(input);
  const existing = await repository.findOrderById(
    tenant.id,
    input.submissionId
  );
  if (existing) {
    if (
      existing.tenantId === tenant.id &&
      existing.source === "kiosk" &&
      existing.fingerprint === fingerprint
    ) {
      return { ok: true as const, reference: existing.reference, replay: true };
    }
    throw new KioskServiceError("could_not_create", 409);
  }

  const [service, statuses, channels] = await Promise.all([
    repository.findActiveService(tenant.id, input.serviceId),
    repository.listInitialStatuses(tenant.id),
    repository.listKioskChannels(tenant.id),
  ]);

  if (!service) {
    throw new KioskServiceError("invalid_configuration", 400);
  }
  if (
    service.tenantId !== tenant.id ||
    !service.active ||
    statuses.length !== 1 ||
    channels.length !== 1
  ) {
    throw new KioskServiceError("invalid_configuration", 503);
  }

  try {
    const inserted = await repository.insertOrder({
      id: input.submissionId,
      tenant_id: tenant.id,
      title: deriveOrderTitle({
        description: input.description,
        serviceName: service.name,
      }),
      description: input.description,
      service_id: service.id,
      status_id: statuses[0].id,
      entry_channel_id: channels[0].id,
      priority: "normal",
      due_at: input.dueAt,
      notes: buildKioskOrderNotes({
        ...input.contact,
        observations: input.observations,
      }),
      metadata: {
        source: "kiosk",
        kiosk: {
          submission_id: input.submissionId,
          request_fingerprint: fingerprint,
          contact: input.contact,
        },
      },
      created_by: null,
    });

    return { ok: true as const, reference: inserted.reference, replay: false };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      const concurrent = await repository.findOrderById(
        tenant.id,
        input.submissionId
      );
      if (
        concurrent?.tenantId === tenant.id &&
        concurrent.source === "kiosk" &&
        concurrent.fingerprint === fingerprint
      ) {
        return {
          ok: true as const,
          reference: concurrent.reference,
          replay: true,
        };
      }
      throw new KioskServiceError("could_not_create", 409);
    }
    throw error;
  }
}
