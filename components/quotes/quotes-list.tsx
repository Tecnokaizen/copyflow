"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { Button } from "@/components/ui/button";
import type { QuoteRecord, QuoteStatusRef } from "@/lib/quotes/types";

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatValidity(value: string | null) {
  if (!value) {
    return "—";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

export function QuotesList() {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [statuses, setStatuses] = useState<QuoteStatusRef[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void reloadKey;
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    if (appliedQuery) {
      params.set("q", appliedQuery);
    }
    if (status) {
      params.set("status", status);
    }

    Promise.all([
      fetch(`/api/quotes?${params.toString()}`),
      fetch("/api/quotes/statuses"),
    ])
      .then(async ([listResponse, statusResponse]) => {
        const listBody = await listResponse.json();
        const statusBody = await statusResponse.json();
        if (!listResponse.ok) {
          throw new Error(listBody.error ?? "No se pudieron cargar los presupuestos");
        }

        return {
          quotes: (Array.isArray(listBody.quotes) ? listBody.quotes : []) as QuoteRecord[],
          totalPages: Number(listBody.total_pages) || 0,
          statuses: (statusResponse.ok && Array.isArray(statusBody.statuses)
            ? statusBody.statuses
            : []) as QuoteStatusRef[],
        };
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setQuotes(result.quotes);
        setTotalPages(result.totalPages);
        setStatuses(result.statuses);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error ? err.message : "No se pudieron cargar los presupuestos"
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appliedQuery, page, reloadKey, status]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPage(1);
    setAppliedQuery(query.trim());
  }

  const filteredEmpty = Boolean(appliedQuery || status);

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Presupuestos"
        description="Solicitudes y presupuestos de esta organización."
        actions={
          <Button asChild>
            <Link href="/quotes/new">Nuevo presupuesto</Link>
          </Button>
        }
      />
      <SectionCard>
        <form onSubmit={search} className="mb-5 grid gap-3 sm:grid-cols-[1fr_14rem_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por referencia, título o descripción"
            className="min-h-11 rounded-md border bg-background px-3 py-2 text-base"
            aria-label="Buscar presupuestos"
          />
          <select
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value);
              setPage(1);
            }}
            className="min-h-11 rounded-md border bg-background px-3 py-2 text-base"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {statuses.map((item) => (
              <option key={item.id} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        {loading ? <LoadingState label="Cargando presupuestos" /> : null}
        {!loading && error ? (
          <ErrorState
            title="No se pudieron cargar los presupuestos"
            description={error}
            onRetry={() => {
              setLoading(true);
              setError(null);
              setReloadKey((current) => current + 1);
            }}
          />
        ) : null}
        {!loading && !error && quotes.length === 0 ? (
          <EmptyState
            title={filteredEmpty ? "Ningún presupuesto coincide" : "Todavía no hay presupuestos"}
            description={
              filteredEmpty
                ? "Prueba con otra búsqueda o con otro estado."
                : "Crea el primero para registrar una solicitud."
            }
            action={
              filteredEmpty ? null : (
                <Button asChild>
                  <Link href="/quotes/new">Nuevo presupuesto</Link>
                </Button>
              )
            }
          />
        ) : null}

        {!loading && !error && quotes.length > 0 ? (
          <>
            <div className="grid gap-3 md:hidden">
              {quotes.map((quote) => (
                <Link
                  key={quote.id}
                  href={`/quotes/${quote.id}`}
                  className="rounded-md border border-border/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">{quote.reference}</p>
                    {quote.status ? (
                      <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm">{quote.client?.name ?? "Sin cliente"}</p>
                  <p className="text-sm text-muted-foreground">
                    {quote.service?.name ?? "Sin servicio"} · {quote.assignee?.name ?? "Sin responsable"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatWhen(quote.created_at)}
                    {quote.valid_until ? ` · Válido hasta ${formatValidity(quote.valid_until)}` : ""}
                  </p>
                </Link>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/70">
                    <th className="px-2 py-3 font-medium">Referencia</th>
                    <th className="px-2 py-3 font-medium">Cliente</th>
                    <th className="px-2 py-3 font-medium">Servicio</th>
                    <th className="px-2 py-3 font-medium">Estado</th>
                    <th className="px-2 py-3 font-medium">Responsable</th>
                    <th className="px-2 py-3 font-medium">Creado</th>
                    <th className="px-2 py-3 font-medium">Validez</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-b border-border/50">
                      <td className="px-2 py-3 font-medium">
                        <Link href={`/quotes/${quote.id}`} className="text-primary">
                          {quote.reference}
                        </Link>
                      </td>
                      <td className="px-2 py-3">{quote.client?.name ?? "—"}</td>
                      <td className="px-2 py-3">{quote.service?.name ?? "—"}</td>
                      <td className="px-2 py-3">
                        {quote.status ? (
                          <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-3">{quote.assignee?.name ?? "—"}</td>
                      <td className="px-2 py-3">{formatWhen(quote.created_at)}</td>
                      <td className="px-2 py-3">{formatValidity(quote.valid_until)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage((current) => Math.max(1, current - 1));
                }}
              >
                Anterior
              </Button>
              <p className="text-sm text-muted-foreground">
                Página {page} de {Math.max(totalPages, 1)}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={totalPages === 0 || page >= totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage((current) => current + 1);
                }}
              >
                Siguiente
              </Button>
            </div>
          </>
        ) : null}
      </SectionCard>
    </AppShell>
  );
}
