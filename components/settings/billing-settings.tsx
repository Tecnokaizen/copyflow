"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import { formatBinaryStorage } from "@/lib/settings/files";
import {
  formatBillingDate,
  formatCancellationLabel,
  formatSubscriptionStatusLabel,
} from "@/lib/billing/cancellation-display";

type BillingSubscriptionResponse = {
  tenant: { id: string; slug: string; name: string };
  subscription: {
    status: string;
    provider: string | null;
    cancel_at_period_end: boolean;
    cancel_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    has_stripe_customer: boolean;
    plan: {
      code: string;
      name: string;
      price_monthly: number | string | null;
      currency: string;
    } | null;
  } | null;
  storage: {
    limit_bytes: number | null;
    used_bytes: number | null;
  };
};

function formatPrice(monthly: number | string | null, currency: string) {
  if (monthly == null) {
    return "—";
  }
  const value = typeof monthly === "string" ? Number(monthly) : monthly;
  if (!Number.isFinite(value)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: currency || "EUR",
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export function BillingSettings() {
  const [data, setData] = useState<BillingSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/subscription", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se ha podido cargar la facturación.");
      }
      setData((await response.json()) as BillingSubscriptionResponse);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se ha podido cargar la facturación."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function startCheckout() {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/billing/checkout-session", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_code: "basic",
          billing_interval: "month",
        }),
      });
      const body = (await response.json()) as {
        url?: string;
        error?: string;
        code?: string;
      };
      if (response.status === 409 && body.code === "checkout_processing") {
        throw new Error("Estamos confirmando tu suscripción.");
      }
      if (response.status === 409 && body.code === "current_subscription_exists") {
        throw new Error("Ya existe una suscripción activa para esta organización.");
      }
      if (response.status === 503) {
        throw new Error(
          "El pago no está disponible ahora mismo. Inténtalo de nuevo en unos segundos."
        );
      }
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? "No se ha podido iniciar el pago.");
      }
      window.location.assign(body.url);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se ha podido iniciar el pago."
      );
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/billing/portal-session", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? "No se ha podido abrir el portal.");
      }
      window.location.assign(body.url);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se ha podido abrir el portal."
      );
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingState label="Cargando facturación…" />;
  }

  if (error || !data) {
    return (
      <ErrorState
        title="No se ha podido cargar la facturación"
        description={error ?? "Error desconocido"}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  const subscription = data.subscription;
  const plan = subscription?.plan ?? null;
  const isStripeManaged =
    subscription?.provider === "stripe" &&
    Boolean(subscription.has_stripe_customer);
  const canCheckout =
    !subscription ||
    subscription.provider !== "stripe" ||
    subscription.status === "canceled";

  return (
    <div className="grid gap-4">
      <SectionCard title="Plan actual" bodyClassName="p-5 sm:p-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-medium">{plan?.name ?? "Sin plan comercial"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Estado</dt>
            <dd className="font-medium">
              {formatSubscriptionStatusLabel(subscription?.status ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Precio</dt>
            <dd className="font-medium">
              {plan
                ? `${formatPrice(plan.price_monthly, plan.currency)} / mes`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Periodo actual</dt>
            <dd className="font-medium">
              {formatBillingDate(subscription?.current_period_start ?? null)}
              {" → "}
              {formatBillingDate(subscription?.current_period_end ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cancelación</dt>
            <dd className="font-medium">
              {formatCancellationLabel({
                cancelAt: subscription?.cancel_at,
                cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
                currentPeriodEnd: subscription?.current_period_end,
              })}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Almacenamiento incluido</dt>
            <dd className="font-medium">
              {data.storage.limit_bytes == null
                ? "Sin cuota configurada"
                : formatBinaryStorage(data.storage.limit_bytes)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Almacenamiento utilizado</dt>
            <dd className="font-medium">
              {data.storage.used_bytes == null
                ? "—"
                : formatBinaryStorage(data.storage.used_bytes)}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Acciones" bodyClassName="p-5 sm:p-6">
        <div className="flex flex-wrap gap-3">
          {canCheckout ? (
            <Button type="button" disabled={busy} onClick={() => void startCheckout()}>
              Contratar Gestcopy Basic
            </Button>
          ) : null}
          {isStripeManaged ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void openPortal()}
            >
              Gestionar suscripción
            </Button>
          ) : null}
        </div>
        {actionError ? (
          <p className="mt-3 text-sm text-destructive">{actionError}</p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          El estado comercial se actualiza cuando Stripe confirma el evento. La
          página de retorno no activa la suscripción por sí sola.
        </p>
      </SectionCard>
    </div>
  );
}
