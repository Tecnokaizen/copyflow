export const TENANT_BASE_DOMAIN = "app.gestcopy.com";

export function tenantHost(slug: string) {
  return `${slug}.${TENANT_BASE_DOMAIN}`;
}

export function tenantOrigin(slug: string) {
  return `https://${tenantHost(slug)}`;
}
