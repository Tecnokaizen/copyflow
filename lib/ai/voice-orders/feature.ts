import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";

export const VOICE_ORDERS_FEATURE_CODE = "voice_orders";

export const AI_VOICE_MESSAGES = {
  unauthenticated: "No autenticado",
  unauthorized: "No autorizado",
  notFound: "No encontrado",
  unavailable: "Pedidos por voz no disponibles",
  budgetExhausted: "Presupuesto de IA agotado",
  rateLimited: "Límite diario de peticiones de IA alcanzado",
  invalidOrigin: "Origen no permitido",
  invalidAudio: "Audio no válido",
  audioTooLarge: "Audio demasiado grande",
  invalidTranscript: "Transcripción no válida",
  providerFailed: "El proveedor de IA no respondió",
  providerTimeout: "El proveedor de IA superó el tiempo de espera",
} as const;

export function isVoiceOrdersEnvEnabled() {
  return process.env.AI_VOICE_ORDERS_ENABLED === "true";
}

export function canAccessVoiceOrdersModule(
  role: string | null | undefined,
  featureEnabled: boolean
) {
  return featureEnabled && hasMembershipRole(role, OPERATIVE_ROLES);
}

export function voiceOrdersProviderConfigured() {
  const provider = (
    process.env.AI_PROVIDER ??
    process.env.AI_TRANSCRIPTION_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();

  if (provider === "fake") {
    return true;
  }

  if (provider === "openai" || provider === "") {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  return false;
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
