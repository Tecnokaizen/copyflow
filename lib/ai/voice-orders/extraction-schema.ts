/** Internal json_schema for Structured Outputs. Never exposed to the client. */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "description",
    "notes",
    "client",
    "service_ref",
    "store_ref",
    "channel_ref",
    "context_ref",
    "assignee_ref",
    "priority",
    "due",
    "evidence",
    "ambiguities",
  ],
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    client: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "phone", "company"],
      properties: {
        name: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        company: { type: ["string", "null"] },
      },
    },
    service_ref: { type: ["string", "null"] },
    store_ref: { type: ["string", "null"] },
    channel_ref: { type: ["string", "null"] },
    context_ref: { type: ["string", "null"] },
    assignee_ref: { type: ["string", "null"] },
    priority: {
      type: ["string", "null"],
      enum: ["normal", "high", "urgent", null],
    },
    due: {
      type: "object",
      additionalProperties: false,
      required: [
        "kind",
        "date",
        "offset_days",
        "weekday",
        "week_offset",
        "time",
        "expression",
      ],
      properties: {
        kind: {
          type: "string",
          enum: ["none", "absolute", "relative_days", "weekday"],
        },
        date: { type: ["string", "null"] },
        offset_days: { type: ["integer", "null"] },
        weekday: { type: ["integer", "null"] },
        week_offset: { type: ["integer", "null"] },
        time: { type: ["string", "null"] },
        expression: { type: ["string", "null"] },
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "quote"],
        properties: {
          field: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "reason"],
        properties: {
          field: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;
