export const VOICE_ORDER_DRAFT_VERSION = "voice-order-draft/v1" as const;

export type DraftConfidence = "high" | "medium" | "low";

export type CatalogRef = {
  id: string;
  label: string;
};

export type ClientCandidate = CatalogRef & {
  match: "exact_phone" | "exact_name" | "partial";
  phone_hint: string | null;
};

export type DraftField<T> =
  | {
      status: "proposed";
      value: T;
      confidence: DraftConfidence;
      heard: string | null;
    }
  | { status: "ambiguous"; candidates: T[]; heard: string; reason: string }
  | { status: "missing" }
  | {
      status: "rejected";
      heard: string;
      reason:
        | "not_in_catalog"
        | "inactive"
        | "invalid"
        | "past_date"
        | "nonexistent_local_time";
    };

export type DraftDue = {
  due_at_iso: string;
  civil_date: string;
  time: string;
  timezone: string;
  expression: string;
};

export type DraftDuePartial = {
  civil_date: string;
  timezone: string;
  expression: string;
};

export type VoiceDraftWarningCode =
  | "missing_time"
  | "ambiguous_weekday"
  | "dst_ambiguous_time"
  | "client_homonyms"
  | "client_not_found"
  | "transcript_truncated"
  | "low_confidence"
  | "field_hidden_in_layout"
  | "unsupported_detail_moved_to_description";

export type VoiceOrderDraft = {
  version: typeof VOICE_ORDER_DRAFT_VERSION;
  draft_id: string;
  tenant_slug: string;
  generated_at: string;
  transcript: {
    text: string;
    source: "audio" | "typed";
    language: string | null;
    truncated: boolean;
  };
  fields: {
    title: DraftField<string>;
    description: DraftField<string>;
    notes: DraftField<string>;
    client: DraftField<ClientCandidate>;
    client_mention: {
      name: string | null;
      phone: string | null;
      company: string | null;
    } | null;
    service: DraftField<CatalogRef>;
    store: DraftField<CatalogRef>;
    entry_channel: DraftField<CatalogRef>;
    order_context: DraftField<CatalogRef>;
    assigned_team_member: DraftField<CatalogRef>;
    priority: DraftField<"normal" | "high" | "urgent">;
    due:
      | DraftField<DraftDue>
      | { status: "partial"; value: DraftDuePartial; heard: string };
  };
  warnings: { code: VoiceDraftWarningCode; field?: string; message: string }[];
};

export function missingField<T>(): DraftField<T> {
  return { status: "missing" };
}

export function proposedField<T>(
  value: T,
  confidence: DraftConfidence = "medium",
  heard: string | null = null
): DraftField<T> {
  return { status: "proposed", value, confidence, heard };
}
