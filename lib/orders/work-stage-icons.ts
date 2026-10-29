// SUR4 E7: closed set of work_stages.icon (CHECK in 20261028130000).
export const WORK_STAGE_ICONS = [
  "design",
  "prepare",
  "print",
  "finish",
  "cut",
  "bind",
  "review",
  "deliver",
  "other",
] as const;

export type WorkStageIcon = (typeof WORK_STAGE_ICONS)[number];

export const WORK_STAGE_ICON_LABELS: Record<WorkStageIcon, string> = {
  design: "Diseño",
  prepare: "Preparación",
  print: "Impresión",
  finish: "Acabado",
  cut: "Corte",
  bind: "Encuadernación",
  review: "Revisión",
  deliver: "Entrega",
  other: "Otra",
};

export function isWorkStageIcon(value: unknown): value is WorkStageIcon {
  return typeof value === "string" && (WORK_STAGE_ICONS as readonly string[]).includes(value);
}
