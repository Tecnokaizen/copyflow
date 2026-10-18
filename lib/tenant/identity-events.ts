import type { publicOrganizationIdentity } from "@/lib/tenant/branding";

export type OrganizationIdentity = ReturnType<typeof publicOrganizationIdentity>;

export const ORGANIZATION_IDENTITY_CHANGED = "gestcopy:organization-identity-changed";

export type OrganizationIdentityChange = {
  identity: OrganizationIdentity;
  revision: string;
};

export function versionedLogoUrl(url: string | null, revision: string) {
  return url ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(revision)}` : null;
}

export function notifyOrganizationIdentityChanged(identity: OrganizationIdentity) {
  const detail: OrganizationIdentityChange = {
    identity,
    revision: crypto.randomUUID(),
  };
  window.dispatchEvent(new CustomEvent(ORGANIZATION_IDENTITY_CHANGED, { detail }));
  return detail.revision;
}
