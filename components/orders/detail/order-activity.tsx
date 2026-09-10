import { SectionCard } from "@/components/gestcopy/section-card";
import {
  formatActivityDate,
  formatActivityText,
} from "@/lib/orders/format";
import type { ActivityItem } from "@/lib/orders/types";

export function OrderActivity({
  activity,
  loading,
}: {
  activity: ActivityItem[];
  loading: boolean;
}) {
  return (
    <SectionCard title="Actividad" bodyClassName="px-5 py-2 sm:px-6">
      {loading ? (
        <p className="py-4 text-sm text-muted-foreground">
          Cargando historial…
        </p>
      ) : activity.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Todavía no hay actividad registrada.
        </p>
      ) : (
        <ul className="relative">
          {activity.map((item, index) => (
            <li
              key={item.id}
              className="relative border-b border-border/60 py-4 last:border-b-0"
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
                  <div className="text-sm text-foreground">
                    {formatActivityText(item)}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {item.actor?.name ?? "Usuario"} ·{" "}
                    {formatActivityDate(item.created_at)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
