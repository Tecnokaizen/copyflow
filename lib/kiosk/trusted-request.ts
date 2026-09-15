import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  getSubdomainFromHostname,
  normalizeHostname,
} from "@/lib/tenant/hostname";

type KioskEnvironment = {
  VERCEL?: string;
  NODE_ENV?: string;
};

export type TrustedKioskContext = {
  tenantSlug: string;
  clientAddress: string;
};

export type KioskCapability = {
  tenantSlug: string;
  clientKey: string;
  issuedAt: number;
  signature: string;
};

export function trustedKioskRequestContext(
  headers: Headers,
  environment: KioskEnvironment
): TrustedKioskContext | null {
  if (environment.VERCEL === "1") {
    const host = headers.get("host");
    const forwardedHost = headers.get("x-forwarded-host");
    const forwardedFor = headers.get("x-vercel-forwarded-for");
    if (
      !host ||
      !forwardedHost ||
      normalizeHostname(host) !== normalizeHostname(forwardedHost) ||
      !forwardedFor ||
      forwardedFor.includes(",") ||
      isIP(forwardedFor.trim()) === 0
    ) {
      return null;
    }
    const tenantSlug = getSubdomainFromHostname(host);
    return tenantSlug
      ? { tenantSlug, clientAddress: forwardedFor.trim() }
      : null;
  }

  if (environment.NODE_ENV === "development") {
    const tenantSlug = getSubdomainFromHostname(headers.get("host") ?? "");
    return tenantSlug
      ? { tenantSlug, clientAddress: "local-development" }
      : null;
  }

  return null;
}

export function createKioskCapability(
  context: TrustedKioskContext & { issuedAt: number },
  secret: string
): KioskCapability {
  if (secret.length < 32) {
    throw new Error("Kiosk signing secret must contain at least 32 characters");
  }
  const clientKey = createHmac("sha256", secret)
    .update(`client|${context.clientAddress}`)
    .digest("hex");
  const signature = createHmac("sha256", secret)
    .update(
      `kiosk-v1|${context.tenantSlug}|${clientKey}|${context.issuedAt}`
    )
    .digest("hex");
  return {
    tenantSlug: context.tenantSlug,
    clientKey,
    issuedAt: context.issuedAt,
    signature,
  };
}
