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

function parseAuthority(raw: string | null) {
  if (!raw || raw.length > 260) return null;
  const match = raw.match(
    /^(([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?)(?::([0-9]{1,5}))?$/i
  );
  if (!match) return null;
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65_535)) return null;
  const hostname = normalizeHostname(match[1]);
  return {
    hostname,
    canonical: port === null ? hostname : `${hostname}:${port}`,
  };
}

export function trustedKioskRequestContext(
  headers: Headers,
  environment: KioskEnvironment
): TrustedKioskContext | null {
  if (environment.VERCEL === "1") {
    const host = parseAuthority(headers.get("host"));
    const forwardedHost = parseAuthority(headers.get("x-forwarded-host"));
    const forwardedFor = headers.get("x-vercel-forwarded-for");
    if (
      !host ||
      !forwardedHost ||
      host.canonical !== forwardedHost.canonical ||
      !forwardedFor ||
      forwardedFor.includes(",") ||
      isIP(forwardedFor.trim()) === 0
    ) {
      return null;
    }
    const tenantSlug = getSubdomainFromHostname(host.hostname);
    return tenantSlug
      ? { tenantSlug, clientAddress: forwardedFor.trim() }
      : null;
  }

  if (environment.NODE_ENV === "development") {
    const host = parseAuthority(headers.get("host"));
    const tenantSlug = host
      ? getSubdomainFromHostname(host.hostname)
      : null;
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
