import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalJson } from "@/lib/http/operational-cache";
import {
  AI_VOICE_MESSAGES,
  VOICE_ORDERS_FEATURE_CODE,
} from "@/lib/ai/voice-orders/feature";

export type AiOperation = "transcription" | "extraction";

export type ReserveUsageInput = {
  tenantId: string;
  operation: AiOperation;
  requestId: string;
  estimatedMicros: number;
  provider: string;
  model: string;
  pricingVersion: string;
};

export type SettleUsageInput = {
  eventId: string;
  status: "committed" | "released";
  actualMicros?: number | null;
  audioSeconds?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  errorCode?: string | null;
};

function rpcMessage(error: { message?: string; code?: string; hint?: string } | null) {
  const message = error?.message ?? "";
  const hint = error?.hint ?? "";
  return `${message} ${hint}`.toLowerCase();
}

export function mapAiBudgetError(error: {
  message?: string;
  code?: string;
  hint?: string;
} | null) {
  const text = rpcMessage(error);

  if (text.includes("ai_budget_exhausted") || text.includes("platform_disabled")) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.budgetExhausted, code: "ai_budget_exhausted" },
      { status: 429 }
    );
  }

  if (text.includes("ai_rate_limited")) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.rateLimited, code: "ai_rate_limited" },
      { status: 429 }
    );
  }

  if (text.includes("feature disabled")) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.notFound, code: "feature_disabled" },
      { status: 404 }
    );
  }

  if (text.includes("tenant access denied") || text.includes("not authenticated")) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.unauthorized, code: "unauthorized" },
      { status: 403 }
    );
  }

  return operationalJson(
    { error: AI_VOICE_MESSAGES.unavailable, code: "ai_unavailable" },
    { status: 503 }
  );
}

export async function reserveAiUsage(
  supabase: SupabaseClient,
  input: ReserveUsageInput
) {
  const { data, error } = await supabase.rpc("ai_reserve_usage", {
    p_tenant_id: input.tenantId,
    p_feature: VOICE_ORDERS_FEATURE_CODE,
    p_operation: input.operation,
    p_request_id: input.requestId,
    p_estimated_micros: input.estimatedMicros,
    p_provider: input.provider,
    p_model: input.model,
    p_pricing_version: input.pricingVersion,
  });

  if (error || typeof data !== "string") {
    return { ok: false as const, response: mapAiBudgetError(error) };
  }

  return { ok: true as const, eventId: data };
}

export async function settleAiUsage(
  supabase: SupabaseClient,
  input: SettleUsageInput
) {
  const { error } = await supabase.rpc("ai_settle_usage", {
    p_event_id: input.eventId,
    p_status: input.status,
    p_actual_micros: input.actualMicros ?? null,
    p_audio_seconds: input.audioSeconds ?? null,
    p_input_tokens: input.inputTokens ?? null,
    p_output_tokens: input.outputTokens ?? null,
    p_error_code: input.errorCode ?? null,
  });

  return { ok: !error, error };
}

export async function loadAiVoiceStatus(
  supabase: SupabaseClient,
  tenantId: string
) {
  const { data, error } = await supabase.rpc("ai_voice_status", {
    p_tenant_id: tenantId,
  });

  if (error || !data || typeof data !== "object") {
    return null;
  }

  return data as {
    feature_enabled: boolean;
    budget_enabled: boolean;
    reason: string | null;
    limits: {
      max_clip_seconds: number | null;
      max_audio_bytes: number | null;
      daily_request_limit: number | null;
    };
    remaining: {
      user_requests_today: number | null;
    };
  };
}
