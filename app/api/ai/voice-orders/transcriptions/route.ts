import { operationalJson } from "@/lib/http/operational-cache";
import {
  AI_VOICE_MESSAGES,
  assertSameOrigin,
  requireVoiceOrdersAccess,
} from "@/lib/ai/access";
import { reserveAiUsage, settleAiUsage } from "@/lib/ai/budget";
import {
  AI_PRICING_VERSION,
  estimateTranscriptionReserveMicros,
  transcriptionActualMicros,
} from "@/lib/ai/pricing";
import { getTranscriptionProvider } from "@/lib/ai/providers/registry";
import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_CLIP_SECONDS,
  audioFilenameForMime,
  validateAudioBytes,
} from "@/lib/ai/voice-orders/audio";
import { loadAiVoiceStatus } from "@/lib/ai/budget";

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidOrigin, code: "invalid_origin" },
      { status: 403 }
    );
  }

  const access = await requireVoiceOrdersAccess(
    "POST /api/ai/voice-orders/transcriptions"
  );
  if (!access.ok) {
    return access.response;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidAudio, code: "invalid_audio" },
      { status: 422 }
    );
  }

  const requestId = String(form.get("request_id") ?? "");
  if (!UUID_RE.test(requestId)) {
    return operationalJson(
      { error: "request_id inválido", code: "invalid_request_id" },
      { status: 422 }
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidAudio, code: "invalid_audio" },
      { status: 422 }
    );
  }

  const status = await loadAiVoiceStatus(
    access.supabase,
    access.context.tenant.id
  );
  const maxBytes = status?.limits.max_audio_bytes ?? DEFAULT_MAX_AUDIO_BYTES;
  const maxClip = status?.limits.max_clip_seconds ?? DEFAULT_MAX_CLIP_SECONDS;

  if (!status?.budget_enabled) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.budgetExhausted, code: "ai_budget_exhausted" },
      { status: 429 }
    );
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.audioTooLarge, code: "audio_too_large" },
      { status: 413 }
    );
  }

  const mimeType = audio.type || "application/octet-stream";
  const validation = validateAudioBytes(bytes, mimeType);
  if (!validation.ok) {
    return operationalJson(
      {
        error: AI_VOICE_MESSAGES.invalidAudio,
        code: validation.reason === "mime" ? "unsupported_mime" : "invalid_audio",
      },
      { status: validation.reason === "mime" ? 415 : 422 }
    );
  }

  const provider = getTranscriptionProvider();
  const estimated = estimateTranscriptionReserveMicros(maxClip);
  const reserved = await reserveAiUsage(access.supabase, {
    tenantId: access.context.tenant.id,
    operation: "transcription",
    requestId,
    estimatedMicros: estimated,
    provider: provider.name,
    model: provider.model,
    pricingVersion: AI_PRICING_VERSION,
  });

  if (!reserved.ok) {
    return reserved.response;
  }

  let settleStatus: "committed" | "released" = "released";
  let actualMicros: number | null = null;
  let audioSeconds: number | null = null;
  let errorCode: string | null = null;
  let providerReached = false;

  try {
    const controller = AbortSignal.timeout(25_000);
    providerReached = true;
    const result = await provider.transcribe({
      bytes,
      mimeType,
      filename: audioFilenameForMime(mimeType),
      language: "es",
      signal: controller,
    });

    audioSeconds = result.audioSecondsEstimate;
    actualMicros = transcriptionActualMicros(audioSeconds ?? maxClip);
    settleStatus = "committed";

    console.info(
      JSON.stringify({
        scope: "ai_voice_orders",
        operation: "transcription",
        tenant_id: access.context.tenant.id,
        request_id: requestId,
        provider: result.provider,
        model: result.model,
        status: "committed",
        micros: actualMicros,
      })
    );

    return operationalJson({
      request_id: requestId,
      transcript: {
        text: result.text,
        language: result.language,
      },
      truncated: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider_failed";
    const timedOut = message.includes("TimeoutError") || message.includes("abort");
    errorCode = timedOut ? "provider_timeout" : "provider_failed";
    settleStatus = providerReached ? "committed" : "released";
    actualMicros = providerReached ? estimated : 0;

    console.info(
      JSON.stringify({
        scope: "ai_voice_orders",
        operation: "transcription",
        tenant_id: access.context.tenant.id,
        request_id: requestId,
        status: settleStatus,
        error_code: errorCode,
        micros: actualMicros,
      })
    );

    return operationalJson(
      {
        error: timedOut
          ? AI_VOICE_MESSAGES.providerTimeout
          : AI_VOICE_MESSAGES.providerFailed,
        code: errorCode,
      },
      { status: timedOut ? 504 : 502 }
    );
  } finally {
    await settleAiUsage(access.supabase, {
      eventId: reserved.eventId,
      status: settleStatus,
      actualMicros,
      audioSeconds,
      errorCode,
    });
  }
}
