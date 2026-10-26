import type { ModelExtraction } from "@/lib/ai/providers/types";
import type {
  DraftDue,
  DraftDuePartial,
  DraftField,
  VoiceDraftWarningCode,
} from "@/lib/ai/voice-orders/contract";
import {
  addCivilDays,
  getZonedDayBounds,
  parseCivilDate,
  resolveTimeZone,
  zonedWallTimeToUtcChecked,
} from "@/lib/time/zoned-day";

type DueResult = {
  field:
    | DraftField<DraftDue>
    | { status: "partial"; value: DraftDuePartial; heard: string };
  warnings: { code: VoiceDraftWarningCode; field?: string; message: string }[];
};

function zonedWeekday(civilDate: string, timeZone: string) {
  const parsed = parseCivilDate(civilDate);
  if (!parsed.ok) return null;
  // ISO weekday 1..7 Mon..Sun
  const utcNoon = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).formatToParts(new Date(utcNoon));
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const label = parts.find((part) => part.type === "weekday")?.value ?? "";
  return map[label] ?? null;
}

export function resolveVoiceDue(
  due: ModelExtraction["due"],
  now: Date,
  tenantTimezone: string | null | undefined
): DueResult {
  const timezone = resolveTimeZone(tenantTimezone);
  const warnings: DueResult["warnings"] = [];
  const expression = due.expression ?? "";

  if (due.kind === "none") {
    return { field: { status: "missing" }, warnings };
  }

  const today = getZonedDayBounds(now, timezone).date;
  let civil: string | null = null;

  if (due.kind === "absolute" && due.date) {
    const parsed = parseCivilDate(due.date);
    civil = parsed.ok ? parsed.date : null;
  } else if (due.kind === "relative_days" && typeof due.offset_days === "number") {
    civil = addCivilDays(today, due.offset_days);
  } else if (due.kind === "weekday" && typeof due.weekday === "number") {
    const current = zonedWeekday(today, timezone);
    if (current !== null) {
      let delta = (due.weekday - current + 7) % 7;
      const weekOffset = due.week_offset ?? 0;
      if (weekOffset === 1) {
        delta = delta === 0 ? 7 : delta + 7;
      } else if (delta === 0) {
        warnings.push({
          code: "ambiguous_weekday",
          field: "due",
          message: "El día de la semana coincide con hoy; confirma si es hoy o la próxima semana.",
        });
      }
      civil = addCivilDays(today, delta);
    }
  }

  if (!civil) {
    return {
      field: {
        status: "rejected",
        heard: expression || "fecha",
        reason: "invalid",
      },
      warnings,
    };
  }

  if (!due.time) {
    warnings.push({
      code: "missing_time",
      field: "due",
      message: "Falta la hora de entrega; indícala antes de crear el pedido.",
    });
    return {
      field: {
        status: "partial",
        value: { civil_date: civil, timezone, expression },
        heard: expression || civil,
      },
      warnings,
    };
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(due.time);
  if (!timeMatch) {
    return {
      field: {
        status: "rejected",
        heard: expression || due.time,
        reason: "invalid",
      },
      warnings,
    };
  }

  const parsed = parseCivilDate(civil);
  if (!parsed.ok) {
    return {
      field: {
        status: "rejected",
        heard: expression || civil,
        reason: "invalid",
      },
      warnings,
    };
  }

  const checked = zonedWallTimeToUtcChecked(
    timezone,
    parsed.year,
    parsed.month,
    parsed.day,
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0
  );

  if (!checked.ok) {
    return {
      field: {
        status: "rejected",
        heard: expression || `${civil} ${due.time}`,
        reason: "nonexistent_local_time",
      },
      warnings,
    };
  }

  if (checked.dstAmbiguous) {
    warnings.push({
      code: "dst_ambiguous_time",
      field: "due",
      message: "La hora cae en un cambio de horario; se usa la primera ocurrencia.",
    });
  }

  if (checked.instant.getTime() < now.getTime()) {
    return {
      field: {
        status: "rejected",
        heard: expression || `${civil} ${due.time}`,
        reason: "past_date",
      },
      warnings,
    };
  }

  return {
    field: {
      status: "proposed",
      confidence: "high",
      heard: expression || null,
      value: {
        due_at_iso: checked.instant.toISOString(),
        civil_date: civil,
        time: due.time,
        timezone,
        expression,
      },
    },
    warnings,
  };
}
