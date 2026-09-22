export const TENANT_BASE_DOMAIN = "app.gestcopy.com";
export const LOCAL_TENANT_BASE_DOMAIN = "localhost";

/** Deterministic production tenant host (emails, invitations, billing fallbacks). */
export function tenantHost(slug: string) {
  return `${slug}.${TENANT_BASE_DOMAIN}`;
}

/** Deterministic production tenant origin. */
export function tenantOrigin(slug: string) {
  return `https://${tenantHost(slug)}`;
}

export type TenantRequestContext = {
  protocol: string;
  hostname: string;
  /** Browser Location.port (empty when default for the protocol). */
  port?: string;
};

export function isLocalDevHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().split(":")[0];
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  );
}

/**
 * Request-aware tenant host.
 * Local apex / *.localhost → `{slug}.localhost`; otherwise production.
 */
export function resolveTenantHost(
  slug: string,
  context?: TenantRequestContext | null
): string {
  if (context && isLocalDevHostname(context.hostname)) {
    return `${slug}.${LOCAL_TENANT_BASE_DOMAIN}`;
  }
  return tenantHost(slug);
}

/**
 * Request-aware tenant origin.
 * Preserves local protocol and port (e.g. http://billing-sandbox.localhost:3000).
 * Without a local context, returns the production https origin unchanged.
 */
export function resolveTenantOrigin(
  slug: string,
  context?: TenantRequestContext | null
): string {
  if (context && isLocalDevHostname(context.hostname)) {
    const protocol = context.protocol === "https:" ? "https:" : "http:";
    const port = context.port?.trim();
    const suffix = port ? `:${port}` : "";
    return `${protocol}//${slug}.${LOCAL_TENANT_BASE_DOMAIN}${suffix}`;
  }
  return tenantOrigin(slug);
}

export function tenantRequestContextFromLocation(location: {
  protocol: string;
  hostname: string;
  port: string;
}): TenantRequestContext {
  return {
    protocol: location.protocol,
    hostname: location.hostname,
    port: location.port || undefined,
  };
}
