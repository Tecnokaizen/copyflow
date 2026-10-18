import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";

export const AI_VOICE_MESSAGES = {
  unauthenticated: "No autenticado",
  unauthorized: "No autorizado",
  notFound: "No encontrado",
  unavailable: "Pedidos por voz no disponibles",
  budgetExhausted: "Presupuesto de IA agotado",
  rateLimited: "Límite diario de peticiones de IA alcanzado",
  requestConflict: "Petición de IA duplicada",
  invalidOrigin: "Origen no permitido",
  invalidAudio: "Audio no válido",
  audioTooLarge: "Audio demasiado grande",
  invalidTranscript: "Transcripción no válida",
  providerFailed: "El proveedor de IA no respondió",
  providerTimeout: "El proveedor de IA superó el tiempo de espera",
} as const;

type AiEnv = Record<string, string | undefined>;

export type AiProviderName = "fake" | "openai";
export type AiProviderKind = "transcription" | "extraction";

export function isVoiceOrdersEnvEnabled(env: AiEnv = process.env) {
  return env.AI_VOICE_ORDERS_ENABLED === "true";
}

export function canAccessVoiceOrdersModule(
  role: string | null | undefined,
  featureEnabled: boolean
) {
  return featureEnabled && hasMembershipRole(role, OPERATIVE_ROLES);
}

/** Vercel Production deployment (not Preview/Staging, not local). */
export function isProductionDeployment(env: AiEnv = process.env) {
  return env.VERCEL_ENV === "production";
}

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Provider for one operation, or null when it must not run. Fail-closed:
 * - AI_PROVIDER wins over AI_TRANSCRIPTION_PROVIDER / AI_EXTRACTION_PROVIDER;
 * - `fake` never runs on Vercel Production (canned drafts would look real);
 * - `openai` (explicit, or implied by a key) needs OPENAI_API_KEY and an
 *   explicit model: provider model names are not confirmed yet (gate G2);
 * - nothing configured, or an unknown name, means unavailable.
 */
export function resolveAiProviderName(
  kind: AiProviderKind,
  env: AiEnv = process.env
): AiProviderName | null {
  const requested =
    normalized(env.AI_PROVIDER) ||
    normalized(
      kind === "transcription"
        ? env.AI_TRANSCRIPTION_PROVIDER
        : env.AI_EXTRACTION_PROVIDER
    );

  if (requested === "fake") {
    return isProductionDeployment(env) ? null : "fake";
  }

  if (requested === "openai" || requested === "") {
    const model =
      kind === "transcription"
        ? env.AI_TRANSCRIPTION_MODEL
        : env.AI_EXTRACTION_MODEL;
    return env.OPENAI_API_KEY?.trim() && model?.trim() ? "openai" : null;
  }

  return null;
}

export function voiceOrdersProviderConfigured(env: AiEnv = process.env) {
  return (
    resolveAiProviderName("transcription", env) !== null &&
    resolveAiProviderName("extraction", env) !== null
  );
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const requestHost = new URL(request.url).host;
    const originHost = new URL(origin).host;
    return requestHost === originHost;
  } catch {
    return false;
  }
}
