import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

const DEFAULT_TIMEZONE = "Europe/Madrid";

function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOnboardingPayload(payload: unknown):
  | { ok: true; name: string; slug: string; timezone: string }
  | { ok: false } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false };
  }

  const record = payload as Record<string, unknown>;
  const allowedKeys = new Set(["name", "slug", "timezone"]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false };
  }

  const name = emptyToNull(record.name);
  const slug = emptyToNull(record.slug);

  if (!name || !slug) {
    return { ok: false };
  }

  if (record.timezone != null && typeof record.timezone !== "string") {
    return { ok: false };
  }

  const timezone = emptyToNull(record.timezone) ?? DEFAULT_TIMEZONE;

  return { ok: true, name, slug, timezone };
}

function statusForOnboardingError(code: string | undefined) {
  switch (code) {
    case "28000":
      return 401;
    case "22023":
    case "23514":
      return 400;
    case "23505":
    case "54000":
      return 409;
    default:
      return 500;
  }
}

function errorMessageForOnboardingError(code: string | undefined) {
  switch (code) {
    case "28000":
      return "Unauthorized";
    case "22023":
    case "23514":
      return "Invalid value";
    case "23505":
      return "Slug already exists";
    case "54000":
      return "Organization limit reached";
    default:
      return "Could not create organization";
  }
}

function isTenantHostFromRequest(request: NextRequest) {
  const hostname =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "";
  return getSubdomainFromHostname(hostname) !== null;
}

export async function POST(request: NextRequest) {
  if (isTenantHostFromRequest(request)) {
    return NextResponse.json(
      { error: "Onboarding is only available on the app host" },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const parsed = parseOnboardingPayload(body);

  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid value" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.name,
    p_slug: parsed.slug,
    p_timezone: parsed.timezone,
  });

  if (error || !data) {
    const status = statusForOnboardingError(error?.code);

    console.error("[POST /api/onboarding] Could not create organization", {
      userId: user.id,
      error,
    });

    return NextResponse.json(
      { error: errorMessageForOnboardingError(error?.code) },
      { status }
    );
  }

  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  const tenantId =
    typeof record.tenant_id === "string" ? record.tenant_id : null;
  const slug = typeof record.slug === "string" ? record.slug : null;
  const name = typeof record.name === "string" ? record.name : null;

  if (!tenantId || !slug || !name) {
    console.error("[POST /api/onboarding] Invalid RPC payload", {
      userId: user.id,
    });

    return NextResponse.json(
      { error: "Could not create organization" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      tenant: {
        id: tenantId,
        slug,
        name,
      },
    },
    { status: 201 }
  );
}
