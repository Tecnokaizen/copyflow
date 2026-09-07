"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import {
  DEFAULT_TIMEZONE,
  finalizeSlug,
  getSlugIssue,
  normalizeSlugInput,
  slugFromName,
} from "@/lib/onboarding/slug";
import {
  TENANT_BASE_DOMAIN,
  tenantHost,
  tenantOrigin,
} from "@/lib/tenant/domains";

const TIMEZONES = [
  { value: "Europe/Madrid", label: "Europa/Madrid (Península)" },
  { value: "Atlantic/Canary", label: "Atlántico/Canarias" },
  { value: "Europe/Lisbon", label: "Europa/Lisboa" },
  { value: "UTC", label: "UTC" },
] as const;

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

function errorFromStatus(status: number) {
  if (status === 400) {
    return "El valor no es válido.";
  }

  if (status === 409) {
    return "Ese identificador ya está en uso.";
  }

  if (status === 401) {
    return "Tu sesión no es válida. Vuelve a iniciar sesión.";
  }

  return "No se pudo crear la organización.";
}

export function OnboardingForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);

  const previewSlug = finalizeSlug(slug);
  const slugIssue = previewSlug ? getSlugIssue(previewSlug) : null;

  useEffect(() => {
    if (!createdSlug) {
      return;
    }

    const origin = tenantOrigin(createdSlug);
    const timeout = window.setTimeout(() => {
      window.location.assign(origin);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [createdSlug]);

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

      if (!response.ok) {
        setError(errorFromStatus(response.status));
        return;
      }

      const payload = (await response.json()) as {
        tenant?: { slug?: unknown };
      };
      const responseSlug =
        typeof payload.tenant?.slug === "string"
          ? finalizeSlug(payload.tenant.slug)
          : "";

      if (!responseSlug) {
        setError("No se pudo crear la organización.");
        return;
      }

      setCreatedSlug(responseSlug);
    } catch {
      setError("No se pudo crear la organización.");
    } finally {
      setIsLoading(false);
    }
  }

  if (createdSlug) {
    const origin = tenantOrigin(createdSlug);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Organización creada</CardTitle>
          <CardDescription>
            Te estamos llevando a tu espacio de Copyflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tu copistería ya está lista en{" "}
            <span className="font-medium text-foreground">
              {tenantHost(createdSlug)}
            </span>
            .
          </p>
          <Button asChild className="w-full">
            <a href={origin}>Entrar ahora</a>
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
          Da de alta tu copistería. Este identificador será la dirección de tu
          espacio.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              <span className="font-medium text-foreground">
                {previewSlug
                  ? tenantHost(previewSlug)
                  : `tu-negocio.${TENANT_BASE_DOMAIN}`}
              </span>
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
            {isLoading ? "Creando..." : "Crear organización"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
