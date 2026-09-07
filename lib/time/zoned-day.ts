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
