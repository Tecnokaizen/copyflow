"use client";

import { useEffect, useState } from "react";
import { ActivityEventCard } from "@/components/activity/activity-event-card";
import { ContextualActivity } from "@/components/gestcopy/contextual-activity";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { mapActivityEvent, type ActivityEvent } from "@/lib/activity/types";

export function ClientActivity({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/activity`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudo cargar la actividad");
        const rows = Array.isArray(body.events) ? body.events : [];
        return rows
          .map((row: unknown) => mapActivityEvent(row))
          .filter((event: ActivityEvent | null): event is ActivityEvent => event !== null);
      })
      .then((next) => {
        if (!cancelled) setEvents(next);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div className="mt-6">
      <ContextualActivity count={events.length} loading={loading}>
        {loading ? (
          <LoadingState label="Cargando historial…" className="px-0 py-6" />
        ) : events.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Todavía no hay actividad registrada.</p>
        ) : (
          <div>
            {events.map((event) => (
              <ActivityEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </ContextualActivity>
    </div>
  );
}
