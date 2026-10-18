import type {
  ExtractionProvider,
  TranscriptionProvider,
} from "@/lib/ai/providers/types";

export function createFakeTranscriptionProvider(): TranscriptionProvider {
  return {
    name: "fake",
    model: "fake-transcribe",
    async transcribe(input) {
      const hint = new TextDecoder().decode(input.bytes.slice(0, 200));
      const text =
        hint.trim().length > 0 && !hint.includes("\0")
          ? hint.trim()
          : "Pedido de tarjetas para Juan García, mañana a las diez, urgente";
      return {
        text,
        language: "es",
        provider: "fake",
        model: "fake-transcribe",
        audioSecondsEstimate: 8,
      };
    },
  };
}

export function createFakeExtractionProvider(): ExtractionProvider {
  return {
    name: "fake",
    model: "fake-extract",
    async extract(input) {
      const lower = input.transcript.toLowerCase();
      const service =
        input.catalog.services.find((item) =>
          lower.includes(item.label.toLowerCase())
        ) ?? input.catalog.services[0] ?? null;
      const store =
        input.catalog.stores.find((item) =>
          lower.includes(item.label.toLowerCase())
        ) ?? null;
      const urgent = /urgent|corre prisa|prioridad alta/.test(lower);

      return {
        provider: "fake",
        model: "fake-extract",
        inputTokens: 1200,
        outputTokens: 220,
        extraction: {
          title: service ? `Pedido ${service.label}` : "Pedido dictado",
          description: input.transcript.slice(0, 400),
          notes: null,
          client: {
            name: /juan/.test(lower) ? "Juan García" : null,
            phone: null,
            company: null,
          },
          service_ref: service?.ref ?? null,
          store_ref: store?.ref ?? null,
          channel_ref: null,
          context_ref: null,
          assignee_ref: null,
          priority: urgent ? "urgent" : null,
          due: {
            kind: /mañana/.test(lower) ? "relative_days" : "none",
            date: null,
            offset_days: /mañana/.test(lower) ? 1 : null,
            weekday: null,
            week_offset: null,
            time: /diez|10/.test(lower) ? "10:00" : null,
            expression: /mañana/.test(lower) ? "mañana a las diez" : null,
          },
          evidence: [],
          ambiguities: [],
        },
      };
    },
  };
}
