"use client";

import { useEffect, useState } from "react";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { TenantBrand } from "@/components/tenant-brand";
import { Button } from "@/components/ui/button";
import { parseBrandColor } from "@/lib/tenant/branding";

type Identity = {
  business_name: string | null;
  display_name: string;
  logo_url: string | null;
  branding: { brand_color: string | null };
};

export function OrganizationSettings() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/settings/organization", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("No se ha podido cargar la identidad.");
        const body = (await response.json()) as Identity;
        if (cancelled) return;
        setIdentity(body);
        setName(body.business_name ?? "");
        setColor(body.branding.brand_color ?? "");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "No se ha podido cargar la identidad."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function reload() {
    setLoading(true);
    setError(null);
    void fetch("/api/settings/organization", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se ha podido cargar la identidad.");
        return (await response.json()) as Identity;
      })
      .then((body) => {
        setIdentity(body);
        setName(body.business_name ?? "");
        setColor(body.branding.brand_color ?? "");
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "No se ha podido cargar la identidad."
        );
        setLoading(false);
      });
  }

  const draftColor = parseBrandColor(color);
  const previewColor = draftColor === undefined ? identity?.branding.brand_color ?? null : draftColor;
  const logoUrl = identity?.logo_url
    ? `${identity.logo_url}?v=${logoVersion}`
    : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (draftColor === undefined) {
      setError("El color debe ser un hexadecimal de 6 dígitos, por ejemplo #1D4ED8.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: name,
          brand_color: draftColor,
        }),
      });
      const body = (await response.json()) as Identity & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se ha podido guardar.");
      setIdentity(body);
      setName(body.business_name ?? "");
      setColor(body.branding.brand_color ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/settings/organization/logo", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as Identity & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "No se ha podido subir el logo.");
    setIdentity(body);
    setLogoVersion((current) => current + 1);
  }

  async function deleteLogo() {
    setError(null);
    const response = await fetch("/api/settings/organization/logo", {
      method: "DELETE",
    });
    const body = (await response.json()) as Identity & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "No se ha podido quitar el logo.");
    setIdentity(body);
  }

  if (loading) return <LoadingState label="Cargando identidad…" />;
  if (error && !identity) {
    return (
      <ErrorState
        title="No se ha podido cargar la identidad"
        description={error}
        onRetry={() => reload()}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <SectionCard title="Vista previa" bodyClassName="p-5 sm:p-6">
        <div className="rounded-md border border-border/80 bg-background px-4 py-3 dark:bg-card">
          <TenantBrand
            displayName={name.trim() || identity?.display_name || ""}
            logoUrl={logoUrl}
            brandColor={previewColor}
          />
        </div>
      </SectionCard>

      <SectionCard title="Identidad" bodyClassName="p-5 sm:p-6">
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <label className="grid gap-1.5 text-sm">
            Nombre visible
            <input
              className="gc-field-control"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Color de marca
            <input
              className="gc-field-control font-mono"
              value={color}
              placeholder="#1D4ED8"
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={saving}>
              Guardar identidad
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving || !color}
              onClick={() => setColor("")}
            >
              Quitar color
            </Button>
          </div>
        </form>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Logo" bodyClassName="p-5 sm:p-6">
        <p className="mb-3 text-sm text-muted-foreground">
          PNG, JPEG o WebP. Máximo 2 MiB.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-4 text-sm font-medium">
            {identity?.logo_url ? "Sustituir logo" : "Subir logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void uploadLogo(file).catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "No se ha podido subir el logo.");
                });
              }}
            />
          </label>
          {identity?.logo_url ? (
            <Button type="button" variant="outline" onClick={() => void deleteLogo()}>
              Quitar logo
            </Button>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
