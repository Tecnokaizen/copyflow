const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function civilDateToLocalDate(value: string) {
  const match = CIVIL_DATE.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function localDateToCivil(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCivilDate(value: string) {
  const date = civilDateToLocalDate(value);
  if (!date) {
    return "";
  }

  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "short" })
    .format(date)
    .replace(".", "");
  const day = new Intl.DateTimeFormat("es-ES", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("es-ES", { month: "short" })
    .format(date)
    .replace(".", "");

  return `${weekday}, ${day} ${month} ${date.getFullYear()}`;
}

export function addLocalCivilDays(days: number, now = new Date()) {
  return localDateToCivil(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12)
  );
}

export function isClockTime(value: string) {
  return CLOCK_TIME.test(value);
}

export function quarterHourOptions() {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 15, 30, 45]) {
      options.push(
        `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      );
    }
  }

  return options;
}

export function splitDateTimeLocal(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match || !civilDateToLocalDate(match[1]) || !isClockTime(match[2])) {
    return { date: "", time: "" };
  }

  return { date: match[1], time: match[2] };
}

/** Complete local datetime, or empty. A date without a valid hour is not a value. */
export function combineDateTimeLocal(date: string, time: string) {
  if (!civilDateToLocalDate(date) || !isClockTime(time)) {
    return "";
  }

  return `${date}T${time}`;
}
