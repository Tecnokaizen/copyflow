// SUR4 E5/E7: activity texts for Post-its and the work sequence. The
// migrations log these actions without any note text or reason (T9), so the
// texts only use states, stage names and people.

export const NOTE_ACTIVITY_ACTIONS = [
  "order.note_created",
  "order.note_edited",
  "order.note_printable_authorized",
  "order.note_made_internal",
  "order.note_pinned",
  "order.note_unpinned",
  "order.note_resolved",
  "order.note_reopened",
  "order.note_voided",
  "order.note_redacted",
  "order.legacy_notes_converted",
] as const;

export const WORK_STEP_ACTIVITY_ACTIONS = [
  "order.work_steps_changed",
  "order.work_step_completed",
  "order.work_step_reopened",
] as const;

export type OrderWorkActivityAction =
  | (typeof NOTE_ACTIVITY_ACTIONS)[number]
  | (typeof WORK_STEP_ACTIVITY_ACTIONS)[number];

export const ORDER_WORK_ACTIVITY_OPTIONS: {
  value: OrderWorkActivityAction;
  label: string;
}[] = [
  { value: "order.note_created", label: "Post-it añadido" },
  { value: "order.note_edited", label: "Post-it editado" },
  { value: "order.note_printable_authorized", label: "Post-it marcado imprimible" },
  { value: "order.note_voided", label: "Post-it anulado" },
  { value: "order.note_redacted", label: "Texto de post-it suprimido" },
  { value: "order.legacy_notes_converted", label: "Notas anteriores a post-it" },
  { value: "order.work_steps_changed", label: "Secuencia cambiada" },
  { value: "order.work_step_completed", label: "Paso hecho" },
  { value: "order.work_step_reopened", label: "Paso reabierto" },
];

const ALL_ACTIONS: ReadonlySet<string> = new Set([
  ...NOTE_ACTIVITY_ACTIONS,
  ...WORK_STEP_ACTIVITY_ACTIONS,
]);

export function isOrderWorkActivityAction(
  action: string
): action is OrderWorkActivityAction {
  return ALL_ACTIONS.has(action);
}

type Values = Record<string, unknown> | null | undefined;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function describeSteps(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "sin pasos";
  return value
    .map((raw) => {
      const step = (raw ?? {}) as Record<string, unknown>;
      const stage = text(step.stage_name) ?? "Fase";
      const person = text(step.team_member_name);
      return person ? `${stage} (${person})` : stage;
    })
    .join(" → ");
}

const NOTE_TEXT: Record<(typeof NOTE_ACTIVITY_ACTIONS)[number], string> = {
  "order.note_created": "Añadió un post-it",
  "order.note_edited": "Editó un post-it",
  "order.note_printable_authorized": "Autorizó imprimir un post-it",
  "order.note_made_internal": "Volvió a hacer interno un post-it",
  "order.note_pinned": "Fijó un post-it",
  "order.note_unpinned": "Quitó un post-it de los fijados",
  "order.note_resolved": "Resolvió un post-it",
  "order.note_reopened": "Reabrió un post-it",
  "order.note_voided": "Anuló un post-it",
  "order.note_redacted": "Suprimió el texto de un post-it",
  "order.legacy_notes_converted": "Pasó las notas anteriores a un post-it interno",
};

/** One line for the order page («Actividad» card). Null for other actions. */
export function orderWorkActivityText(
  action: string,
  previous: Values,
  next: Values
): string | null {
  if (!isOrderWorkActivityAction(action)) return null;

  if (action === "order.note_created") {
    return next?.visibility === "printable"
      ? "Añadió un post-it imprimible"
      : "Añadió un post-it interno";
  }
  if (action in NOTE_TEXT) {
    return NOTE_TEXT[action as keyof typeof NOTE_TEXT];
  }

  if (action === "order.work_steps_changed") {
    return `Secuencia de trabajo: ${describeSteps(previous?.steps)} ⇒ ${describeSteps(next?.steps)}`;
  }

  const stage = text(next?.stage_name) ?? text(previous?.stage_name) ?? "un paso";
  if (action === "order.work_step_completed") {
    const executor = text(next?.executed_by_name);
    return executor ? `Paso hecho: ${stage}, por ${executor}` : `Paso hecho: ${stage}`;
  }
  return `Paso reabierto: ${stage}`;
}

/** Headline for the global activity page, e.g. «Marcó hecho Preparación en S4C-0020». */
export function orderWorkActivityHeadline(
  action: string,
  previous: Values,
  next: Values,
  entity: string
): string | null {
  if (!isOrderWorkActivityAction(action)) return null;
  if (action === "order.work_steps_changed") {
    return `Cambió la secuencia de trabajo de ${entity}`;
  }
  const stage = text(next?.stage_name) ?? text(previous?.stage_name) ?? "un paso";
  if (action === "order.work_step_completed") {
    return `Marcó hecho el paso ${stage} de ${entity}`;
  }
  if (action === "order.work_step_reopened") {
    return `Reabrió el paso ${stage} de ${entity}`;
  }
  const line = orderWorkActivityText(action, previous, next) ?? "Actualizó un post-it";
  return `${line} en ${entity}`;
}
