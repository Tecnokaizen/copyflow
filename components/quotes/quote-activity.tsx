"use client";

import { useEffect, useState } from "react";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { formatActivityEvent } from "@/lib/activity/format";
import { mapActivityEvent, type ActivityEvent } from "@/lib/activity/types";
import { formatActivityDate } from "@/lib/orders/format";

export function QuoteActivity({
  quoteId,
  reloadKey,
}: {
  quoteId: string;
  reloadKey: number;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/quotes/${quoteId}/activity`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "No se pudo cargar la actividad");
        }

        const rows = Array.isArray(body.events) ? body.events : [];
        return rows
          .map((row: unknown) => mapActivityEvent(row))
          .filter((event: ActivityEvent | null): event is ActivityEvent => event !== null);
      })
      .then((next) => {
        if (!cancelled) {
          setEvents(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [quoteId, reloadKey]);

  return (
    <SectionCard title="Actividad" bodyClassName="px-5 py-2 sm:px-6">
      {loading ? (
        <LoadingState label="Cargando historial…" className="px-0 py-6" />
      ) : events.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Todavía no hay actividad registrada.
        </p>
      ) : (
        <ul>
          {events.map((event, index) => {
            const formatted = formatActivityEvent(event);
            return (
              <li
                key={event.id}
                className="border-b border-border/60 py-4 last:border-b-0"
              >
                <div className="flex gap-3">
                  <div className="mt-1.5 flex w-3 shrink-0 justify-center">
                    <span
                      className={
                        index === 0
                          ? "h-2.5 w-2.5 rounded-full bg-primary"
                          : "h-2.5 w-2.5 rounded-full bg-border"
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {formatted.actor}
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {formatted.headline}
                    </p>
                    {formatted.summary ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatted.summary}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatActivityDate(event.created_at)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
