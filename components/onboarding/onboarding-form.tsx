"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardingUserFacingError } from "@/lib/onboarding/errors";
import {
  DEFAULT_TIMEZONE,
  finalizeSlug,
  getSlugIssue,
  normalizeSlugInput,
  slugFromName,
} from "@/lib/onboarding/slug";
import {
  TENANT_BASE_DOMAIN,
  resolveTenantHost,
  tenantRequestContextFromLocation,
  type TenantRequestContext,
} from "@/lib/tenant/domains";

const TIMEZONES = [
  { value: "Europe/Madrid", label: "Europa/Madrid (Península)" },
  { value: "Atlantic/Canary", label: "Atlántico/Canarias" },
  { value: "Europe/Lisbon", label: "Europa/Lisboa" },
  { value: "UTC", label: "UTC" },
] as const;

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

type PendingTenant = {
  id: string;
  slug: string;
  name: string;
};

export function OnboardingForm() {
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled") === "1";

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [pending, setPending] = useState<PendingTenant | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [requestContext, setRequestContext] =
    useState<TenantRequestContext | null>(null);

  const previewSlug = finalizeSlug(slug);
  const slugIssue = previewSlug ? getSlugIssue(previewSlug) : null;
  const previewHost = previewSlug
    ? resolveTenantHost(previewSlug, requestContext)
    : `tu-negocio.${TENANT_BASE_DOMAIN}`;

  useEffect(() => {
    // Intentional one-shot client mount: browser Location is unavailable during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync Location into state after mount
    setRequestContext(tenantRequestContextFromLocation(window.location));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPending() {
      try {
        const response = await fetch("/api/onboarding", {
          headers: { Accept: "application/json" },
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as {
          pending?: { tenant?: PendingTenant } | null;
        };
        if (!cancelled && body.pending?.tenant?.slug) {
          setPending(body.pending.tenant);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setPendingLoaded(true);
        }
      }
    }

    void loadPending();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleNameChange(value: string) {
    setName(value);

    if (!slugTouched) {
      setSlug(slugFromName(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(normalizeSlugInput(value));
  }

  async function redirectToCheckout(checkoutUrl: string) {
    setPreparingCheckout(true);
    window.location.assign(checkoutUrl);
  }

  async function resumeCheckout() {
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resume: true }),
      });

      let payload: {
        code?: unknown;
        error?: unknown;
        checkout_url?: unknown;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        setError(onboardingUserFacingError(response.status, payload));
        return;
      }

      if (typeof payload.checkout_url === "string") {
        await redirectToCheckout(payload.checkout_url);
        return;
      }

      setError("No se pudo preparar el pago.");
    } catch {
      setError("No se pudo preparar el pago.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedName = name.trim();
    const nextSlug = finalizeSlug(slug);

    setSlug(nextSlug);
    setError(null);

    if (!trimmedName) {
      setError("El valor no es válido.");
      return;
    }

    const issue = getSlugIssue(nextSlug);

    if (issue) {
      setError(issue);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: trimmedName,
          slug: nextSlug,
          timezone,
        }),
      });

      let payload: {
        code?: unknown;
        error?: unknown;
        checkout_url?: unknown;
        checkout_pending?: unknown;
        tenant?: PendingTenant;
      } = {};

      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (!response.ok) {
        setError(onboardingUserFacingError(response.status, payload));
        return;
      }

      if (payload.tenant?.slug) {
        setPending(payload.tenant);
      }

      if (typeof payload.checkout_url === "string") {
        await redirectToCheckout(payload.checkout_url);
        return;
      }

      if (payload.checkout_pending) {
        setError(
          "La organización se creó, pero el pago no pudo iniciarse. Pulsa Continuar con el pago."
        );
        return;
      }

      setError("No se pudo preparar el pago.");
    } catch {
      setError("No se pudo crear la organización.");
    } finally {
      setIsLoading(false);
    }
  }

  if (preparingCheckout) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Preparando pago…</CardTitle>
          <CardDescription>
            Te estamos llevando a Stripe Checkout para Gestcopy Basic (39 €/mes).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (pendingLoaded && pending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Continuar alta</CardTitle>
          <CardDescription>
            {canceled
              ? "El pago no se completó."
              : "Tienes un espacio pendiente de activación."}{" "}
            Completa Gestcopy Basic para activar{" "}
            <span className="font-medium text-foreground">{pending.name}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Identificador:{" "}
            <span className="font-medium text-foreground">{pending.slug}</span>
          </p>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <Button
            type="button"
            className="w-full"
            disabled={isLoading}
            onClick={() => void resumeCheckout()}
          >
            {isLoading ? "Preparando…" : "Continuar con el pago"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Crear organización</CardTitle>
        <CardDescription>
          Da de alta tu copistería. Tras crear el espacio completarás el pago de
          Gestcopy Basic (39 €/mes).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canceled ? (
          <p className="mb-4 text-sm text-red-500">El pago no se completó.</p>
        ) : null}
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid gap-2">
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              name="name"
              autoComplete="organization"
              required
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Copistería Sur"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="slug">Identificador</Label>
            <Input
              id="slug"
              name="slug"
              autoComplete="off"
              spellCheck={false}
              required
              value={slug}
              onChange={(event) => handleSlugChange(event.target.value)}
              placeholder="copisteria-sur"
            />
            <p className="text-sm text-muted-foreground">
              Tu espacio será{" "}
              <span className="font-medium text-foreground">{previewHost}</span>
            </p>
            {slugIssue ? (
              <p className="text-sm text-red-500">{slugIssue}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timezone">Zona horaria</Label>
            <select
              id="timezone"
              name="timezone"
              className={selectClassName}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {TIMEZONES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creando…" : "Crear y continuar al pago"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
