const DEFAULT_TIMEZONE = "Europe/Madrid";

export function resolveTimeZone(value: string | null | undefined) {
  const timeZone = value?.trim() || DEFAULT_TIMEZONE;

  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getTimeZoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - instant.getTime();
}

function zonedWallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wallAsUtc - getTimeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  instant = wallAsUtc - getTimeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function getZonedDayBounds(now: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = date.split("-").map(Number);
  const start = zonedWallTimeToUtc(timeZone, year, month, day);
  const end = zonedWallTimeToUtc(timeZone, year, month, day + 1);

  return { date, start, end };
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCivilDate(
  raw: string
): { ok: true; year: number; month: number; day: number; date: string } | { ok: false } {
  const match = CIVIL_DATE_PATTERN.exec(raw.trim());
  if (!match) {
    return { ok: false };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    year,
    month,
    day,
    date: `${match[1]}-${match[2]}-${match[3]}`,
  };
}

export function addCivilDays(civilDate: string, days: number): string | null {
  const parsed = parseCivilDate(civilDate);
  if (!parsed.ok) {
    return null;
  }

  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Monday (YYYY-MM-DD) of the tenant-local week that contains `now`. */
export function getZonedWeekMondayCivil(now: Date, timeZone: string): string {
  const { date } = getZonedDayBounds(now, timeZone);
  const parsed = parseCivilDate(date);
  if (!parsed.ok) {
    return date;
  }

  // Noon UTC of the civil date → stable weekday without DST edge cases.
  const weekday = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0)
  ).getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addCivilDays(date, offset) ?? date;
}

/**
 * Week bounds: Monday 00:00 (inclusive) → next Monday 00:00 (exclusive)
 * in the tenant timezone.
 */
export function getZonedWeekBoundsFromMonday(
  mondayCivil: string,
  timeZone: string
): {
  monday: string;
  days: string[];
  start: Date;
  end: Date;
} | null {
  const parsed = parseCivilDate(mondayCivil);
  if (!parsed.ok) {
    return null;
  }

  // Monday must be Monday in the civil calendar.
  const weekday = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0)
  ).getUTCDay();
  if (weekday !== 1) {
    return null;
  }

  const days: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addCivilDays(parsed.date, i);
    if (!day) {
      return null;
    }
    days.push(day);
  }

  const start = zonedWallTimeToUtc(
    timeZone,
    parsed.year,
    parsed.month,
    parsed.day
  );
  const endCivil = addCivilDays(parsed.date, 7);
  if (!endCivil) {
    return null;
  }
  const endParsed = parseCivilDate(endCivil);
  if (!endParsed.ok) {
    return null;
  }
  const end = zonedWallTimeToUtc(
    timeZone,
    endParsed.year,
    endParsed.month,
    endParsed.day
  );

  return { monday: parsed.date, days, start, end };
}

export function formatZonedCivilDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function formatZonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function formatZonedDayLabel(civilDate: string, timeZone: string): string {
  const parsed = parseCivilDate(civilDate);
  if (!parsed.ok) {
    return civilDate;
  }

  const instant = zonedWallTimeToUtc(
    timeZone,
    parsed.year,
    parsed.month,
    parsed.day,
    12
  );

  return new Intl.DateTimeFormat("es-ES", {
    timeZone,
    weekday: "short",
    day: "numeric",
  }).format(instant);
}

export { DEFAULT_TIMEZONE };
