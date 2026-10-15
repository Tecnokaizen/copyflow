"use client";

import { useMemo, useState } from "react";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/gestcopy/status-badge";
import {
  CHANGELOG_KIND_LABELS,
  CHANGELOG_KIND_PLURALS,
  CHANGELOG_KINDS,
  formatChangelogDate,
  formatChangelogMonth,
  type ChangelogKind,
  type ChangelogRelease,
} from "@/lib/help/changelog";
import { cn } from "@/lib/utils";

const KIND_TONES: Record<ChangelogKind, StatusBadgeTone> = {
  nuevo: "brand",
  mejora: "info",
  correccion: "warning",
  seguridad: "success",
};

const KIND_ORDER: Record<ChangelogKind, number> = {
  nuevo: 0,
  mejora: 1,
  correccion: 2,
  seguridad: 3,
};

type Filter = ChangelogKind | "todo";

type MonthGroup = {
  key: string;
  label: string;
  releases: ChangelogRelease[];
};

function groupByMonth(releases: ChangelogRelease[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const release of releases) {
    const key = release.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.releases.push(release);
    } else {
      groups.push({
        key,
        label: formatChangelogMonth(release.date),
        releases: [release],
      });
    }
  }
  return groups;
}

export function ChangelogTimeline({
  releases,
  counts,
}: {
  releases: ChangelogRelease[];
  counts: Record<ChangelogKind, number>;
}) {
  const [filter, setFilter] = useState<Filter>("todo");
  const total = CHANGELOG_KINDS.reduce((sum, kind) => sum + counts[kind], 0);

  const months = useMemo(() => {
    const visible = releases
      .map((release) => ({
        ...release,
        entries: release.entries
          .filter((entry) => filter === "todo" || entry.kind === filter)
          .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
      }))
      .filter((release) => release.entries.length > 0);
    return groupByMonth(visible);
  }, [releases, filter]);

  const options: { value: Filter; label: string; count: number }[] = [
    { value: "todo", label: "Todo", count: total },
    ...CHANGELOG_KINDS.map((kind) => ({
      value: kind,
      label: CHANGELOG_KIND_PLURALS[kind],
      count: counts[kind],
    })),
  ];

  return (
    <div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrar novedades por tipo"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              "gc-chip gap-2 px-3 py-1.5",
              filter === option.value && "gc-chip-active"
            )}
          >
            {option.label}
            <span className="tabular-nums text-xs text-muted-foreground">
              {option.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-10">
        {months.map((month) => (
          <section key={month.key} aria-labelledby={`mes-${month.key}`}>
            <h2
              id={`mes-${month.key}`}
              className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            >
              {month.label}
            </h2>
            <ol className="mt-4 grid gap-4 border-l border-border/80 pl-5">
              {month.releases.map((release) => (
                <li key={release.date} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.6875rem] top-1.5 size-3 rounded-full border-2 border-background bg-primary"
                  />
                  <article className="rounded-lg border border-border/80 bg-card p-4">
                    <header>
                      <time
                        dateTime={release.date}
                        className="text-sm text-muted-foreground"
                      >
                        {formatChangelogDate(release.date)}
                      </time>
                      <h3 className="mt-0.5 font-semibold tracking-tight">
                        {release.title}
                      </h3>
                    </header>
                    <ul className="mt-3 grid gap-2.5">
                      {release.entries.map((entry) => (
                        <li
                          key={`${entry.kind}-${entry.text}`}
                          className="grid gap-1 text-sm leading-relaxed sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3"
                        >
                          <span>
                            <StatusBadge
                              tone={KIND_TONES[entry.kind]}
                              className="py-0.5"
                            >
                              {CHANGELOG_KIND_LABELS[entry.kind]}
                            </StatusBadge>
                          </span>
                          <p>
                            <span className="font-medium">{entry.area}.</span>{" "}
                            <span className="text-muted-foreground">
                              {entry.text}
                            </span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </article>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
