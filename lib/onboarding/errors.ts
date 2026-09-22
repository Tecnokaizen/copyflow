export const ONBOARDING_ERROR_CODES = {
  TENANT_SLUG_CONFLICT: "tenant_slug_conflict",
  ORGANIZATION_LIMIT_REACHED: "organization_limit_reached",
} as const;

export type OnboardingErrorCode =
  (typeof ONBOARDING_ERROR_CODES)[keyof typeof ONBOARDING_ERROR_CODES];

export type OnboardingApiError = {
  status: number;
  error: string;
  code?: OnboardingErrorCode;
};

/** Map PostgreSQL / PostgREST error codes from create_organization to API shape. */
export function mapOnboardingPostgresError(
  pgCode: string | undefined
): OnboardingApiError {
  switch (pgCode) {
    case "28000":
      return { status: 401, error: "Unauthorized" };
    case "22023":
    case "23514":
      return { status: 400, error: "Invalid value" };
    case "23505":
      return {
        status: 409,
        error: "Tenant slug already exists",
        code: ONBOARDING_ERROR_CODES.TENANT_SLUG_CONFLICT,
      };
    case "54000":
      return {
        status: 409,
        error: "Organization limit reached",
        code: ONBOARDING_ERROR_CODES.ORGANIZATION_LIMIT_REACHED,
      };
    default:
      return { status: 500, error: "Could not create organization" };
  }
}

/**
 * Spanish UI copy from API status + stable machine code.
 * Never map every HTTP 409 to a slug-conflict message.
 */
export function onboardingUserFacingError(
  status: number,
  body: { code?: unknown; error?: unknown } | null | undefined
): string {
  const code = typeof body?.code === "string" ? body.code : undefined;

  if (code === ONBOARDING_ERROR_CODES.TENANT_SLUG_CONFLICT) {
    return "Ese identificador ya está en uso.";
  }

  if (code === ONBOARDING_ERROR_CODES.ORGANIZATION_LIMIT_REACHED) {
    return "Esta cuenta ya administra una organización y no puede crear otra desde este proceso.";
  }

  if (code === "checkout_processing") {
    return "Estamos confirmando tu suscripción.";
  }

  if (code === "current_subscription_exists") {
    return "Ya existe una suscripción activa para esta organización.";
  }

  if (status === 400) {
    return "El valor no es válido.";
  }

  if (status === 401) {
    return "Tu sesión no es válida. Vuelve a iniciar sesión.";
  }

  if (status === 503) {
    return "El pago no está disponible ahora mismo. Inténtalo de nuevo en unos segundos.";
  }

  if (status === 409) {
    return "No se pudo completar la operación por un conflicto.";
  }

  return "No se pudo crear la organización.";
}
