import { formatCivilDate } from "@/lib/gestcopy/date-value";
import { resolveTimeZone } from "@/lib/time/zoned-day";

export function formatPrintTimestamp(
  value: string | null | undefined,
  timeZone: string
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: resolveTimeZone(timeZone),
  }).format(date);
}

export function formatPrintCivilDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return formatCivilDate(value) || null;
}

export function printFileNames(names: Array<string | null | undefined>): string[] {
  return names
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter(Boolean);
}

export function printFileCountLabel(count: number): string {
  return count === 1 ? "1 archivo" : `${count} archivos`;
}
