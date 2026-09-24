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
import { QuoteActivity } from "@/components/quotes/quote-activity";
import { QuoteForm, type QuoteFormValues } from "@/components/quotes/quote-form";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import type { ClientSummary } from "@/lib/clients/types";
import { formatCivilDate } from "@/lib/gestcopy/date-value";
import type { QuoteRecord, QuoteStatusRef } from "@/lib/quotes/types";
import { QUOTE_FLOW_CODES } from "@/lib/quotes/workflow";

function formatValidity(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  return formatCivilDate(value) || value;
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="gc-fact-label">{label}</dt>
      <dd className="gc-fact-value mt-1">{value}</dd>
    </div>
  );
}

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [statuses, setStatuses] = useState<QuoteStatusRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activityKey, setActivityKey] = useState(0);

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

  async function refreshQuote() {
    const response = await fetch(`/api/quotes/${params.id}`);
    const result = await response.json();
    if (!response.ok || !result.quote) {
      throw new Error(result.error ?? "No se encontró el presupuesto");
    }

    setQuote(result.quote as QuoteRecord);
    setActivityKey((current) => current + 1);
  }

  async function save(values: QuoteFormValues) {
    if (!quote || saving) {
      return;
    }

    setSaving(true);
    setFormError(null);
    setSavedMessage(null);

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
      setSavedMessage("Cambios guardados");
      setActivityKey((current) => current + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el presupuesto");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(statusId: string) {
    if (!quote || statusSaving || statusId === quote.status?.id) {
      return;
    }

    setStatusSaving(true);
    setActionError(null);
    setSavedMessage(null);

    try {
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
        throw new Error(result.error ?? "No se pudo cambiar el estado");
      }

      setQuote(result.quote);
      setSavedMessage("Estado actualizado");
      setActivityKey((current) => current + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo cambiar el estado");
    } finally {
      setStatusSaving(false);
    }
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
      setSavedMessage("Presupuesto convertido");
      await refreshQuote();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se pudo convertir el presupuesto"
      );
    } finally {
      setConverting(false);
    }
  }

  return (
    <AppShell innerClassName="max-w-5xl">
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
                <Link
                  href={`/orders/${quote.converted_order.id}`}
                  className="gc-cta min-h-11 w-full sm:w-auto"
                >
                  Abrir pedido {quote.converted_order.reference}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={convert}
                  disabled={converting}
                  className="gc-cta min-h-11 w-full sm:w-auto"
                >
                  {converting ? "Convirtiendo…" : "Convertir en pedido"}
                </button>
              )
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            {quote.status ? (
              <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
            ) : null}
            <p className="text-sm">
              <span className="gc-fact-label">Cliente </span>
              <span className="gc-fact-value">{quote.client?.name ?? "Sin cliente"}</span>
            </p>
            <p className="text-sm">
              <span className="gc-fact-label">Validez </span>
              <span className="gc-fact-value">{formatValidity(quote.valid_until)}</span>
            </p>
          </div>

          {savedMessage ? (
            <p className="mb-4 text-sm text-muted-foreground">{savedMessage}</p>
          ) : null}
          {actionError ? (
            <p className="mb-4 text-sm text-destructive">{actionError}</p>
          ) : null}

          <div className="grid gap-5">
            {editing ? (
              <SectionCard title="Editar presupuesto" bodyClassName="p-5 sm:p-6">
                <QuoteForm
                  initial={formValues(quote)}
                  submitting={saving}
                  error={formError}
                  submitLabel="Guardar presupuesto"
                  onSubmit={save}
                  onCancel={() => {
                    if (!saving) {
                      setEditing(false);
                      setFormError(null);
                    }
                  }}
                />
              </SectionCard>
            ) : (
              <>
                <SectionCard
                  title="Resumen"
                  actions={
                    <button
                      type="button"
                      className="gc-action"
                      onClick={() => {
                        setSavedMessage(null);
                        setEditing(true);
                      }}
                    >
                      Editar
                    </button>
                  }
                  bodyClassName="p-5 sm:p-6"
                >
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <Fact label="Cliente" value={quote.client?.name ?? "Sin cliente"} />
                    <Fact label="Servicio" value={quote.service?.name ?? "Sin servicio"} />
                    <Fact label="Responsable" value={quote.assignee?.name ?? "Sin responsable"} />
                    <Fact label="Estado" value={quote.status?.name ?? "Sin estado"} />
                    <Fact label="Validez" value={formatValidity(quote.valid_until)} />
                  </dl>
                </SectionCard>

                <SectionCard title="Contenido" bodyClassName="p-5 sm:p-6">
                  <dl className="grid gap-4">
                    <Fact label="Título" value={quote.title || "Sin título"} />
                    <div>
                      <dt className="gc-fact-label">Descripción</dt>
                      <dd className="gc-fact-value mt-1 whitespace-pre-wrap">
                        {quote.description}
                      </dd>
                    </div>
                    <div>
                      <dt className="gc-fact-label">Notas</dt>
                      <dd className="gc-fact-value mt-1 whitespace-pre-wrap">
                        {quote.notes || "Sin notas"}
                      </dd>
                    </div>
                  </dl>
                </SectionCard>
              </>
            )}

            <SectionCard title="Gestión" bodyClassName="p-5 sm:p-6">
              <label className="gc-field max-w-sm">
                <span className="gc-field-label">Estado</span>
                <select
                  aria-label="Estado del presupuesto"
                  className="gc-field-control"
                  value={quote.status?.id ?? ""}
                  disabled={statusSaving || editing}
                  onChange={(event) => changeStatus(event.target.value)}
                >
                  {[...statuses]
                    .sort((left, right) => {
                      const leftIndex = QUOTE_FLOW_CODES.indexOf(
                        left.code as (typeof QUOTE_FLOW_CODES)[number]
                      );
                      const rightIndex = QUOTE_FLOW_CODES.indexOf(
                        right.code as (typeof QUOTE_FLOW_CODES)[number]
                      );
                      return (
                        (leftIndex === -1 ? QUOTE_FLOW_CODES.length : leftIndex) -
                        (rightIndex === -1 ? QUOTE_FLOW_CODES.length : rightIndex)
                      );
                    })
                    .map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                </select>
              </label>
              {quote.converted_order ? (
                <p className="mt-4 text-sm">
                  Pedido generado:{" "}
                  <Link
                    href={`/orders/${quote.converted_order.id}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {quote.converted_order.reference}
                  </Link>
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Todavía no se ha convertido en pedido.
                </p>
              )}
            </SectionCard>

            <QuoteActivity quoteId={quote.id} reloadKey={activityKey} />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
