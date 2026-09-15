import { createHash } from "node:crypto";
import { deriveOrderTitle } from "@/lib/orders/create";
import type { KioskOrderInput } from "./payload";
import type { KioskGateway } from "./supabase-gateway";
import type { KioskCapability } from "./trusted-request";

export type KioskBootstrapDto = {
  tenant: { name: string };
  services: Array<{ id: string; name: string }>;
};

export class KioskServiceError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "invalid_configuration"
      | "could_not_create"
      | "rate_limited",
    public readonly status: number
  ) {
    super(code);
    this.name = "KioskServiceError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function kioskInputFingerprint(input: KioskOrderInput) {
  return createHash("sha256")
    .update(kioskCanonicalPayload(input))
    .digest("hex");
}

function canonicalPart(value: string | null) {
  const text = value ?? "";
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

export function kioskCanonicalPayload(input: KioskOrderInput) {
  const title = deriveOrderTitle({ description: input.description });
  return [
    "kiosk-payload-v1",
    canonicalPart(title),
    canonicalPart(input.serviceId),
    canonicalPart(input.contact.name),
    canonicalPart(input.contact.email),
    canonicalPart(input.contact.phone),
    canonicalPart(input.description),
    canonicalPart(input.dueAt),
    canonicalPart(input.observations),
  ].join("|");
}

export function mapKioskBootstrapResult(
  value: unknown
): KioskBootstrapDto | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (result.status !== "ready") return null;
  const tenant =
    result.tenant && typeof result.tenant === "object"
      ? (result.tenant as Record<string, unknown>)
      : null;
  if (
    typeof tenant?.name !== "string" ||
    !Array.isArray(result.services) ||
    result.services.length === 0
  ) {
    return null;
  }
  const services = result.services.map((row) => {
    if (!row || typeof row !== "object") return null;
    const service = row as Record<string, unknown>;
    return typeof service.id === "string" &&
      UUID_PATTERN.test(service.id) &&
      typeof service.name === "string"
      ? { id: service.id, name: service.name }
      : null;
  });
  if (services.some((service) => service === null)) return null;
  return {
    tenant: { name: tenant.name },
    services: services as Array<{ id: string; name: string }>,
  };
}

export function mapKioskAdmissionResult(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new KioskServiceError("could_not_create", 500);
  }
  const result = value as Record<string, unknown>;
  if (
    result.status === "admitted" &&
    typeof result.permit === "string" &&
    UUID_PATTERN.test(result.permit)
  ) {
    return result.permit;
  }
  if (result.status === "rate_limited") {
    throw new KioskServiceError("rate_limited", 429);
  }
  if (result.status === "not_found") {
    throw new KioskServiceError("not_found", 404);
  }
  throw new KioskServiceError("could_not_create", 503);
}

export function mapKioskSubmitResult(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new KioskServiceError("could_not_create", 500);
  }
  const result = value as Record<string, unknown>;
  if (
    (result.status === "created" || result.status === "replay") &&
    typeof result.reference === "string"
  ) {
    return {
      ok: true as const,
      reference: result.reference,
      replay: result.status === "replay",
    };
  }
  if (result.status === "invalid_service") {
    throw new KioskServiceError("invalid_configuration", 400);
  }
  if (result.status === "unavailable") {
    throw new KioskServiceError("invalid_configuration", 503);
  }
  if (result.status === "rate_limited") {
    throw new KioskServiceError("rate_limited", 429);
  }
  if (result.status === "not_found") {
    throw new KioskServiceError("not_found", 404);
  }
  throw new KioskServiceError("could_not_create", 409);
}

export async function getKioskBootstrap(
  capability: KioskCapability,
  gateway: KioskGateway
) {
  return mapKioskBootstrapResult(await gateway.bootstrap(capability));
}

export async function admitKioskRequest(
  capability: KioskCapability,
  gateway: KioskGateway
) {
  return mapKioskAdmissionResult(await gateway.admit(capability));
}

export async function submitKioskOrder(
  capability: KioskCapability,
  permitId: string,
  input: KioskOrderInput,
  gateway: KioskGateway
) {
  return mapKioskSubmitResult(
    await gateway.submit(
      capability,
      permitId,
      input,
      kioskInputFingerprint(input),
      deriveOrderTitle({ description: input.description })
    )
  );
}
