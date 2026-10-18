export type TranscriptionInput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  language?: string | null;
  signal?: AbortSignal;
};

export type TranscriptionResult = {
  text: string;
  language: string | null;
  provider: string;
  model: string;
  audioSecondsEstimate: number | null;
};

export type ExtractionCatalogAlias = {
  ref: string;
  label: string;
};

export type ExtractionInput = {
  transcript: string;
  catalog: {
    services: ExtractionCatalogAlias[];
    stores: ExtractionCatalogAlias[];
    channels: ExtractionCatalogAlias[];
    contexts: ExtractionCatalogAlias[];
    assignees: ExtractionCatalogAlias[];
  };
  locale: string;
  timezone: string;
  nowIso: string;
  signal?: AbortSignal;
};

export type ModelExtraction = {
  title: string | null;
  description: string | null;
  notes: string | null;
  client: {
    name: string | null;
    phone: string | null;
    company: string | null;
  } | null;
  service_ref: string | null;
  store_ref: string | null;
  channel_ref: string | null;
  context_ref: string | null;
  assignee_ref: string | null;
  priority: "normal" | "high" | "urgent" | null;
  due: {
    kind: "none" | "absolute" | "relative_days" | "weekday";
    date: string | null;
    offset_days: number | null;
    weekday: number | null;
    week_offset: number | null;
    time: string | null;
    expression: string | null;
  };
  evidence: { field: string; quote: string }[];
  ambiguities: { field: string; reason: string }[];
};

export type ExtractionResult = {
  extraction: ModelExtraction;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type TranscriptionProvider = {
  name: string;
  model: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
};

export type ExtractionProvider = {
  name: string;
  model: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
};
