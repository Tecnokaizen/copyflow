"use client";

import Link from "next/link";
import { formatActivityDateTime, formatActivityEvent } from "@/lib/activity/format";
import type { ActivityEvent } from "@/lib/activity/types";
import type { ActivityViewMode } from "@/lib/activity/view";
import { cn } from "@/lib/utils";

type ActivityEventCardProps = {
  event: ActivityEvent;
  variant?: ActivityViewMode;
};

export function ActivityEventCard({
  event,
  variant = "list",
}: ActivityEventCardProps) {
  const formatted = formatActivityEvent(event);
  const showChanges = formatted.changes.length > 0;
  const isGrid = variant === "grid";

  return (
    <article
      className={cn(
        "min-w-0",
        isGrid
          ? "flex h-full flex-col rounded-lg border bg-card p-4 shadow-sm"
          : "border-b px-4 py-3 last:border-b-0"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{formatted.actor}</p>
          <p className="mt-1 text-sm">
            {formatted.href ? (
              <HeadlineWithLink
                headline={formatted.headline}
                entityLabel={formatted.entityLabel}
                href={formatted.href}
              />
            ) : (
              formatted.headline
            )}
          </p>
          {formatted.summary && (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatted.summary}
            </p>
          )}
        </div>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={event.created_at}
        >
          {formatActivityDateTime(event.created_at)}
        </time>
      </div>

      {showChanges && (
        <details className={cn("mt-3", isGrid && "mt-auto border-t pt-3")}>
          <summary className="cursor-pointer text-sm text-muted-foreground hover:underline">
            Ver cambios
          </summary>
          <div className="mt-2 grid gap-2 text-sm">
            {formatted.changes.map((change) => (
              <div key={`${change.label}-${change.from}-${change.to}`}>
                <div className="font-medium">{change.label}</div>
                <div className="text-muted-foreground">
                  {change.from} → {change.to}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function HeadlineWithLink({
  headline,
  entityLabel,
  href,
}: {
  headline: string;
  entityLabel: string;
  href: string;
}) {
  const index = entityLabel ? headline.lastIndexOf(entityLabel) : -1;

  if (index < 0) {
    return (
      <Link href={href} className="hover:underline">
        {headline}
      </Link>
    );
  }

  return (
    <>
      {headline.slice(0, index)}
      <Link href={href} className="font-medium hover:underline">
        {headline.slice(index, index + entityLabel.length)}
      </Link>
      {headline.slice(index + entityLabel.length)}
    </>
  );
}
