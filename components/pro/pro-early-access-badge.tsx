import Link from "next/link";

import type { ProEarlyAccessBadge as ProEarlyAccessBadgeData } from "@/lib/nav/pro-badge";
import { cn } from "@/lib/utils";

/** Discreet header label next to the organization identity. */
export function ProEarlyAccessBadge({
  badge,
  active,
}: {
  badge: ProEarlyAccessBadgeData;
  active: boolean;
}) {
  return (
    <Link
      href={badge.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-[0.6875rem] font-semibold tracking-wide transition-colors sm:px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span aria-hidden="true" className="sm:hidden">
        {badge.shortLabel}
      </span>
      <span className="sr-only sm:not-sr-only">{badge.label}</span>
    </Link>
  );
}
