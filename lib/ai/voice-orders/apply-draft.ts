import type { QuickOrderField } from "@/lib/settings/quick-order-layout";
import type { VoiceOrderDraft } from "@/lib/ai/voice-orders/contract";
import { toDateTimeLocalValue } from "@/lib/orders/format";
import { appendRichText } from "@/lib/rich-text/html";

export type VoiceFormSnapshot = {
  title: string;
  description: string;
  notes: string;
  serviceId: string;
  storeId: string;
  entryChannelId: string;
  orderContextId: string;
  assignedTeamMemberId: string;
  priority: "normal" | "high" | "urgent";
  dueAt: string;
  clientId: string | null;
};

export type VoiceTouchedFields = Partial<Record<keyof VoiceFormSnapshot, boolean>>;

export type VoiceApplyReportItem = {
  field: string;
  action: "applied" | "skipped_touched" | "skipped_hidden" | "needs_decision" | "ignored";
  message: string;
};

export type VoiceApplyResult = {
  patch: Partial<{
    title: string;
    description: string;
    descriptionMode: "replace" | "append";
    notes: string;
    serviceId: string;
    storeId: string;
    entryChannelId: string;
    orderContextId: string;
    assignedTeamMemberId: string;
    priority: "normal" | "high" | "urgent";
    dueAtIso: string;
    clientId: string;
    openCreateClientName: string;
  }>;
  report: VoiceApplyReportItem[];
};

const FIELD_TO_QUICK: Record<string, QuickOrderField | null> = {
  title: "title",
  description: "description",
  notes: "notes",
  serviceId: "service",
  storeId: "store",
  entryChannelId: "entry_channel",
  orderContextId: "order_context",
  assignedTeamMemberId: "assigned_team_member",
  priority: "priority",
  dueAt: "due_at",
  clientId: "client",
};

function escapePlainToParagraph(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${escaped.replace(/\n+/g, "</p><p>")}</p>`;
}

export function applyVoiceDraft(
  form: VoiceFormSnapshot,
  draft: VoiceOrderDraft,
  options: {
    mode: "full" | "quick";
    visibleFields: QuickOrderField[];
    touchedFields: VoiceTouchedFields;
    tenantSlug: string;
  }
): VoiceApplyResult {
  const report: VoiceApplyReportItem[] = [];
  const patch: VoiceApplyResult["patch"] = {};

  if (draft.tenant_slug !== options.tenantSlug) {
    return {
      patch: {},
      report: [
        {
          field: "tenant",
          action: "ignored",
          message: "El borrador pertenece a otro tenant y se ha descartado.",
        },
      ],
    };
  }

  const visible = new Set(options.visibleFields);
  const isVisible = (formKey: keyof typeof FIELD_TO_QUICK) => {
    if (options.mode === "full") return true;
    const quick = FIELD_TO_QUICK[formKey];
    if (!quick) return true;
    return visible.has(quick);
  };

  const tryApply = (
    formKey: keyof VoiceTouchedFields,
    apply: () => void,
    label: string
  ) => {
    if (!isVisible(formKey)) {
      report.push({
        field: label,
        action: "skipped_hidden",
        message: "Campo oculto en el pedido rápido.",
      });
      return;
    }
    if (options.touchedFields[formKey]) {
      report.push({
        field: label,
        action: "skipped_touched",
        message: "Ya lo has editado; usa Reemplazar si quieres la propuesta.",
      });
      return;
    }
    apply();
    report.push({
      field: label,
      action: "applied",
      message: "Propuesta aplicada.",
    });
  };

  const { fields } = draft;

  if (fields.title.status === "proposed") {
    tryApply("title", () => {
      patch.title = fields.title.status === "proposed" ? fields.title.value : "";
    }, "title");
  }

  if (fields.description.status === "proposed") {
    const plain = fields.description.value;
    const html = escapePlainToParagraph(plain);
    if (!isVisible("description")) {
      report.push({
        field: "description",
        action: "skipped_hidden",
        message: "Campo oculto en el pedido rápido.",
      });
    } else if (options.touchedFields.description) {
      report.push({
        field: "description",
        action: "skipped_touched",
        message: "Descripción tocada; no se sobrescribe.",
      });
    } else if (form.description.trim()) {
      patch.description = html;
      patch.descriptionMode = "append";
      report.push({
        field: "description",
        action: "applied",
        message: "Texto añadido al final de la descripción.",
      });
    } else {
      patch.description = html;
      patch.descriptionMode = "replace";
      report.push({
        field: "description",
        action: "applied",
        message: "Descripción aplicada.",
      });
    }
  }

  if (fields.notes.status === "proposed") {
    tryApply("notes", () => {
      patch.notes = fields.notes.status === "proposed" ? fields.notes.value : "";
    }, "notes");
  }

  if (fields.service.status === "proposed") {
    tryApply("serviceId", () => {
      patch.serviceId = fields.service.status === "proposed" ? fields.service.value.id : "";
    }, "service");
  }

  if (fields.store.status === "proposed") {
    tryApply("storeId", () => {
      patch.storeId = fields.store.status === "proposed" ? fields.store.value.id : "";
    }, "store");
  }

  if (fields.entry_channel.status === "proposed") {
    tryApply("entryChannelId", () => {
      patch.entryChannelId =
        fields.entry_channel.status === "proposed"
          ? fields.entry_channel.value.id
          : "";
    }, "entry_channel");
  }

  if (fields.order_context.status === "proposed") {
    tryApply("orderContextId", () => {
      patch.orderContextId =
        fields.order_context.status === "proposed"
          ? fields.order_context.value.id
          : "";
    }, "order_context");
  }

  if (fields.assigned_team_member.status === "proposed") {
    tryApply("assignedTeamMemberId", () => {
      patch.assignedTeamMemberId =
        fields.assigned_team_member.status === "proposed"
          ? fields.assigned_team_member.value.id
          : "";
    }, "assigned_team_member");
  }

  if (fields.priority.status === "proposed") {
    tryApply("priority", () => {
      patch.priority =
        fields.priority.status === "proposed" ? fields.priority.value : "normal";
    }, "priority");
  }

  if (fields.due.status === "proposed") {
    tryApply("dueAt", () => {
      patch.dueAtIso =
        fields.due.status === "proposed" ? fields.due.value.due_at_iso : "";
    }, "due");
  } else if (fields.due.status === "partial" || fields.due.status === "ambiguous") {
    report.push({
      field: "due",
      action: "needs_decision",
      message: "La fecha requiere confirmación (falta hora o es ambigua).",
    });
  }

  if (fields.client.status === "proposed") {
    const match = fields.client.value.match;
    if (match === "exact_phone" || match === "exact_name") {
      tryApply("clientId", () => {
        patch.clientId = fields.client.status === "proposed" ? fields.client.value.id : "";
      }, "client");
    } else {
      report.push({
        field: "client",
        action: "needs_decision",
        message: "Coincidencia parcial de cliente; confírmala.",
      });
    }
  } else if (fields.client.status === "ambiguous") {
    report.push({
      field: "client",
      action: "needs_decision",
      message: "Hay varios clientes posibles.",
    });
  } else if (draft.fields.client_mention?.name) {
    patch.openCreateClientName = draft.fields.client_mention.name;
    report.push({
      field: "client",
      action: "needs_decision",
      message: "Cliente no encontrado; puedes crearlo con el nombre oído.",
    });
  }

  return { patch, report };
}

type VoiceFieldKey = keyof VoiceFormSnapshot;

/** Value each field held before the current voice draft, and the value it wrote. */
export type VoiceAppliedFields = Partial<
  Record<VoiceFieldKey, { before: unknown; after: unknown }>
>;

/** Form values once `patch` is applied to `form`, in the form's own format. */
export function projectVoicePatch(
  form: VoiceFormSnapshot,
  patch: VoiceApplyResult["patch"]
): Partial<VoiceFormSnapshot> {
  const next: Partial<VoiceFormSnapshot> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) {
    next.description =
      patch.descriptionMode === "append"
        ? appendRichText(form.description, patch.description)
        : patch.description;
  }
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.serviceId !== undefined) next.serviceId = patch.serviceId;
  if (patch.storeId !== undefined) next.storeId = patch.storeId;
  if (patch.entryChannelId !== undefined) next.entryChannelId = patch.entryChannelId;
  if (patch.orderContextId !== undefined) next.orderContextId = patch.orderContextId;
  if (patch.assignedTeamMemberId !== undefined) {
    next.assignedTeamMemberId = patch.assignedTeamMemberId;
  }
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.dueAtIso !== undefined) next.dueAt = toDateTimeLocalValue(patch.dueAtIso);
  if (patch.clientId) next.clientId = patch.clientId;
  return next;
}

/**
 * Adds one application of the current draft. A field keeps the value it had
 * before the draft's FIRST write, so «Reemplazar» can still be undone.
 */
export function recordVoiceApplication(
  applied: VoiceAppliedFields,
  form: VoiceFormSnapshot,
  projected: Partial<VoiceFormSnapshot>
): VoiceAppliedFields {
  const next: VoiceAppliedFields = { ...applied };
  for (const key of Object.keys(projected) as VoiceFieldKey[]) {
    const after = projected[key];
    const previous = next[key];
    if (!previous && after === form[key]) continue;
    next[key] = { before: previous ? previous.before : form[key], after };
  }
  return next;
}

/**
 * What «Descartar» puts back: every field the draft wrote and nobody touched
 * since returns to its previous value; fields edited after the draft are kept.
 */
export function buildVoiceRevert(
  applied: VoiceAppliedFields,
  current: VoiceFormSnapshot
): { restore: Partial<VoiceFormSnapshot>; kept: VoiceFieldKey[] } {
  const restore: Record<string, unknown> = {};
  const kept: VoiceFieldKey[] = [];
  for (const key of Object.keys(applied) as VoiceFieldKey[]) {
    const entry = applied[key];
    if (!entry) continue;
    if (current[key] === entry.after) {
      restore[key] = entry.before;
    } else if (current[key] !== entry.before) {
      kept.push(key);
    }
  }
  return { restore: restore as Partial<VoiceFormSnapshot>, kept };
}

/**
 * Fields of a restored session draft (#94) that differ from an empty form
 * with its catalog defaults: the user typed them, so a later voice draft
 * must not overwrite them silently.
 */
export function voiceTouchedFromRestoredDraft(
  restored: VoiceFormSnapshot,
  defaults: VoiceFormSnapshot
): VoiceTouchedFields {
  const touched: VoiceTouchedFields = {};
  for (const key of Object.keys(defaults) as VoiceFieldKey[]) {
    if (restored[key] !== defaults[key]) touched[key] = true;
  }
  return touched;
}
