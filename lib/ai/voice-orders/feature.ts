import { resolveOpenAiBaseUrl } from "@/lib/ai/providers/base-url";
import {
  OPERATIVE_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";
import { parseTrustedAuthority } from "@/lib/tenant/trusted-origin";

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
  audioTooLong: "El audio supera la duración máxima",
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
 *   AI_PROVIDER_BASE_URL, when set, must be on the OpenAI allowlist;
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
    return env.OPENAI_API_KEY?.trim() &&
      model?.trim() &&
      resolveOpenAiBaseUrl(env.AI_PROVIDER_BASE_URL)
      ? "openai"
      : null;
  }

  return null;
}

export function voiceOrdersProviderConfigured(env: AiEnv = process.env) {
  return (
    resolveAiProviderName("transcription", env) !== null &&
    resolveAiProviderName("extraction", env) !== null
  );
}

function defaultPort(protocol: string) {
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : null;
}

/**
 * Browser requests must come from the page's own host. Compared with the
 * Host header (the authority the tenant and the session cookies belong to),
 * not with request.url: Next may rebuild that URL with another hostname
 * (e.g. `localhost` for `e2e.localhost`). No Origin (same-origin GET, server
 * tools) is allowed; the session cookie and the tenant guard still apply.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  // Scheme: Vercel reports it in x-forwarded-proto; locally request.url has it.
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const expectedProtocol = forwardedProto
    ? `${forwardedProto}:`
    : new URL(request.url).protocol;
  const host = parseTrustedAuthority(request.headers.get("host"));
  const port = defaultPort(expectedProtocol);
  if (!host || !port || originUrl.protocol !== expectedProtocol) {
    return false;
  }

  return (
    originUrl.hostname.toLowerCase() === host.hostname &&
    (originUrl.port || port) === (host.port ?? port)
  );
}
