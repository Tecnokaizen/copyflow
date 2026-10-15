/**
 * Header label for Gestcopy Pro · Acceso anticipado. It is informative only:
 * it links to /pro and grants nothing (the server checks every request).
 */
export const PRO_EARLY_ACCESS_HREF = "/pro";

export type ProEarlyAccessBadge = {
  href: string;
  /** Visible on wider screens and always the accessible name. */
  label: string;
  /** Visible on mobile only. */
  shortLabel: string;
};

const PRO_EARLY_ACCESS_BADGE: ProEarlyAccessBadge = {
  href: PRO_EARLY_ACCESS_HREF,
  label: "Pro · Acceso anticipado",
  shortLabel: "Pro · Anticipado",
};

/** Hidden until the context has loaded and explicitly reports the program. */
export function proEarlyAccessBadge(input: {
  ready: boolean;
  proEarlyAccess: boolean;
}): ProEarlyAccessBadge | null {
  return input.ready && input.proEarlyAccess === true
    ? PRO_EARLY_ACCESS_BADGE
    : null;
}

export function proEarlyAccessBadgeIsActive(pathname: string) {
  return (
    pathname === PRO_EARLY_ACCESS_HREF ||
    pathname.startsWith(`${PRO_EARLY_ACCESS_HREF}/`)
  );
}
