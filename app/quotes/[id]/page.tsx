"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { QuoteForm, type QuoteFormValues } from "@/components/quotes/quote-form";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { Button } from "@/components/ui/button";
import type { ClientSummary } from "@/lib/clients/types";
import type { QuoteRecord, QuoteStatusRef } from "@/lib/quotes/types";

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatValidity(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function formValues(quote: QuoteRecord): QuoteFormValues {
  const client: ClientSummary | null = quote.client
    ? {
        id: quote.client.id,
        customer_type_id: null,
        customer_type_name: null,
        name: quote.client.name,
        contact_name: null,
        company_name: null,
        tax_id: null,
        email: null,
        phone: null,
        notes: null,
      }
    : null;

  return {
    title: quote.title ?? "",
    description: quote.description,
    notes: quote.notes ?? "",
    validUntil: quote.valid_until ?? "",
    client,
    serviceId: quote.service?.id ?? "",
    assigneeId: quote.assignee?.id ?? "",
  };
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [statuses, setStatuses] = useState<QuoteStatusRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void reloadKey;

    Promise.all([
      fetch(`/api/quotes/${params.id}`),
      fetch("/api/quotes/statuses"),
    ])
      .then(async ([quoteResponse, statusResponse]) => {
        const quoteBody = await quoteResponse.json();
        const statusBody = await statusResponse.json();
        if (!quoteResponse.ok || !quoteBody.quote) {
          throw new Error(quoteBody.error ?? "No se encontró el presupuesto");
        }

        return {
          quote: quoteBody.quote as QuoteRecord,
          statuses: (statusResponse.ok && Array.isArray(statusBody.statuses)
            ? statusBody.statuses
            : []) as QuoteStatusRef[],
        };
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setQuote(result.quote);
        setStatuses(result.statuses);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setError(err instanceof Error ? err.message : "No se encontró el presupuesto");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [params.id, reloadKey]);

  async function save(values: QuoteFormValues) {
    if (!quote || saving) {
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_row_version: quote.row_version,
          title: values.title || null,
          description: values.description,
          notes: values.notes || null,
          valid_until: values.validUntil || null,
          client_id: values.client?.id ?? null,
          service_id: values.serviceId || null,
          assigned_team_member_id: values.assigneeId || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.quote) {
        throw new Error(result.error ?? "No se pudo guardar el presupuesto");
      }

      setQuote(result.quote);
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el presupuesto");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(statusId: string) {
    if (!quote || statusId === quote.status?.id) {
      return;
    }

    setActionError(null);
    const response = await fetch(`/api/quotes/${quote.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status_id: statusId,
        expected_row_version: quote.row_version,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.quote) {
      setActionError(result.error ?? "No se pudo cambiar el estado");
      return;
    }

    setQuote(result.quote);
  }

  async function convert() {
    if (!quote || converting || quote.converted_order) {
      return;
    }

    setConverting(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/quotes/${quote.id}/convert`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || !result.order?.id) {
        throw new Error(result.error ?? "No se pudo convertir el presupuesto");
      }

      setQuote((current) =>
        current
          ? {
              ...current,
              converted_order: {
                id: result.order.id,
                reference: result.order.reference,
              },
            }
          : current
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se pudo convertir el presupuesto"
      );
    } finally {
      setConverting(false);
    }
  }

  return (
    <AppShell>
      <AppNav />
      {loading ? <LoadingState label="Cargando presupuesto" /> : null}
      {!loading && error ? (
        <ErrorState
          title="No se encontró el presupuesto"
          description={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            setReloadKey((current) => current + 1);
          }}
        />
      ) : null}
      {!loading && quote ? (
        <>
          <PageHeader
            title={quote.reference}
            description={quote.title || "Presupuesto"}
            actions={
              quote.converted_order ? (
                <Button asChild variant="outline">
                  <Link href={`/orders/${quote.converted_order.id}`}>Abrir pedido</Link>
                </Button>
              ) : (
                <Button type="button" onClick={convert} disabled={converting}>
                  {converting ? "Convirtiendo…" : "Convertir en pedido"}
                </Button>
              )
            }
          />

          {quote.converted_order ? (
            <SectionCard className="mb-5">
              <p className="text-base">
                Pedido creado:{" "}
                <Link
                  href={`/orders/${quote.converted_order.id}`}
                  className="font-semibold text-primary"
                >
                  {quote.converted_order.reference}
                </Link>
              </p>
            </SectionCard>
          ) : null}

          <div className="grid gap-5">
            <SectionCard
              title="Estado"
              actions={
                <select
                  aria-label="Estado del presupuesto"
                  className="min-h-11 rounded-md border bg-background px-3 py-2 text-base"
                  value={quote.status?.id ?? ""}
                  onChange={(event) => changeStatus(event.target.value)}
                >
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              }
            >
              {quote.status ? (
                <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
              ) : (
                <p>Sin estado</p>
              )}
              {actionError ? <p className="mt-3 text-sm text-destructive">{actionError}</p> : null}
            </SectionCard>

            <SectionCard
              title="Contenido"
              actions={
                editing ? null : (
                  <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                )
              }
            >
              {editing ? (
                <QuoteForm
                  initial={formValues(quote)}
                  submitting={saving}
                  error={formError}
                  submitLabel="Guardar cambios"
                  onSubmit={save}
                />
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">Cliente</dt>
                    <dd>{quote.client?.name ?? "Sin cliente"}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Servicio</dt>
                    <dd>{quote.service?.name ?? "Sin servicio"}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Responsable</dt>
                    <dd>{quote.assignee?.name ?? "Sin responsable"}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Validez</dt>
                    <dd>{formatValidity(quote.valid_until)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">Descripción</dt>
                    <dd className="whitespace-pre-wrap">{quote.description}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">Notas</dt>
                    <dd className="whitespace-pre-wrap">{quote.notes || "Sin notas"}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Creado</dt>
                    <dd>{formatWhen(quote.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Actualizado</dt>
                    <dd>{formatWhen(quote.updated_at)}</dd>
                  </div>
                </dl>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
