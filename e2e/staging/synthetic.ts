/** Synthetic identities only: RFC 2606 reserved domain, never deliverable. */
export const SYNTHETIC_EMAIL = /^e2e[a-z0-9.+-]*@example\.com$/;

export function requireSyntheticEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!SYNTHETIC_EMAIL.test(email)) {
    throw new Error("E2E_USER_EMAIL must be a synthetic address like e2e-owner@example.com");
  }
  return email;
}

/** Unique, sortable per-run id, e.g. `20261014T183012Z-4f2a`. */
export function runId(now = new Date(), random = Math.random): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${stamp}-${Math.floor(random() * 0xffff).toString(16).padStart(4, "0")}`;
}
