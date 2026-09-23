"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { OperationalCreateActions } from "@/components/quotes/operational-create-actions";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { formatCivilDate } from "@/lib/gestcopy/date-value";
import type { QuoteRecord, QuoteStatusRef } from "@/lib/quotes/types";
import {
  parseQuoteListQuery,
  quoteCountLabel,
  quoteListQuery,
  quotePageRange,
  quoteStatusFilters,
} from "@/lib/quotes/workflow";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

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

  return formatCivilDate(value) || value;
}

export function QuotesList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listQuery = parseQuoteListQuery(searchParams);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [statuses, setStatuses] = useState<QuoteStatusRef[]>([]);
  const [query, setQuery] = useState(listQuery.q);
  const [trackedQuery, setTrackedQuery] = useState(listQuery.q);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (listQuery.q !== trackedQuery) {
    setTrackedQuery(listQuery.q);
    setQuery(listQuery.q);
  }

  useEffect(() => {
    let cancelled = false;
    void reloadKey;
    const params = new URLSearchParams({
      page: String(listQuery.page),
      page_size: String(PAGE_SIZE),
    });
    if (listQuery.q) {
      params.set("q", listQuery.q);
    }
    if (listQuery.status) {
      params.set("status", listQuery.status);
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
          total: Number(listBody.total) || 0,
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
        setTotal(result.total);
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
  }, [listQuery.page, listQuery.q, listQuery.status, reloadKey]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (query.trim() === listQuery.q) {
        return;
      }

      setLoading(true);
      router.replace(
        quoteListQuery({
          status: listQuery.status,
          q: query,
          page: 1,
        }),
        { scroll: false }
      );
    }, 250);

    return () => window.clearTimeout(handle);
  }, [listQuery.q, listQuery.status, query, router]);

  function selectStatus(code: string) {
    setLoading(true);
    router.replace(
      quoteListQuery({
        status: code,
        q: listQuery.q,
        page: 1,
      }),
      { scroll: false }
    );
  }

  const filteredEmpty = Boolean(listQuery.q || listQuery.status);
  const filters = quoteStatusFilters(statuses);
  const range = quotePageRange(listQuery.page, PAGE_SIZE, quotes.length, total);

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Presupuestos"
        description={loading && total === 0 ? undefined : quoteCountLabel(total)}
        actions={<OperationalCreateActions primary="quote" />}
      />

      <form
        className="gc-filter-bar"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectStatus("")}
            className={cn("gc-chip", listQuery.status === "" && "gc-chip-active")}
          >
            Todos
          </button>
          {filters.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => selectStatus(item.code)}
              className={cn(
                "gc-chip",
                listQuery.status === item.code && "gc-chip-active"
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
        <label className="gc-field">
          <span className="gc-field-label">Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Referencia, título, descripción o cliente"
            className="gc-field-control"
            aria-label="Buscar presupuestos"
          />
        </label>
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
        <div className="gc-card">
          <EmptyState
            title={filteredEmpty ? "Ningún presupuesto coincide" : "Todavía no hay presupuestos"}
            description={
              filteredEmpty
                ? "Prueba con otra búsqueda o con otro estado."
                : "Crea el primero para registrar una solicitud."
            }
          />
        </div>
      ) : null}

      {!loading && !error && quotes.length > 0 ? (
        <>
          <div className="grid gap-3 md:hidden">
            {quotes.map((quote) => (
              <article key={quote.id} className="gc-list-row">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/quotes/${quote.id}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {quote.reference}
                  </Link>
                  {quote.status ? (
                    <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
                  ) : null}
                </div>
                <p className="mt-2 text-sm">{quote.title || quote.description}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {quote.client?.name ?? "Sin cliente"}
                  {quote.service?.name ? ` · ${quote.service.name}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {quote.assignee?.name ?? "Sin responsable"} · {formatWhen(quote.created_at)}
                </p>
                <p className="mt-2 text-sm">
                  {quote.converted_order ? (
                    <Link
                      href={`/orders/${quote.converted_order.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {quote.converted_order.reference}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      Válido hasta {formatValidity(quote.valid_until)}
                    </span>
                  )}
                </p>
              </article>
            ))}
          </div>

          <div className="gc-card hidden md:block">
            <div className="overflow-x-auto">
              <table className="gc-table">
                <thead>
                  <tr>
                    <th>Referencia</th>
                    <th>Cliente</th>
                    <th>Trabajo / Servicio</th>
                    <th>Estado</th>
                    <th>Responsable</th>
                    <th>Creado</th>
                    <th>Validez</th>
                    <th>Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr
                      key={quote.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/quotes/${quote.id}`)}
                    >
                      <td className="font-semibold">
                        <Link
                          href={`/quotes/${quote.id}`}
                          className="text-foreground hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {quote.reference}
                        </Link>
                      </td>
                      <td>{quote.client?.name ?? "—"}</td>
                      <td>
                        <div>{quote.title || quote.description}</div>
                        {quote.service?.name ? (
                          <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                            {quote.service.name}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {quote.status ? (
                          <QuoteStatusBadge name={quote.status.name} code={quote.status.code} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{quote.assignee?.name ?? "—"}</td>
                      <td>{formatWhen(quote.created_at)}</td>
                      <td>{formatValidity(quote.valid_until)}</td>
                      <td>
                        {quote.converted_order ? (
                          <Link
                            href={`/orders/${quote.converted_order.id}`}
                            className="font-semibold text-foreground hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {quote.converted_order.reference}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {range ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-muted-foreground">
                Mostrando {range.from}–{range.to} de {range.total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="gc-action"
                  disabled={listQuery.page <= 1}
                  onClick={() => {
                    setLoading(true);
                    router.replace(
                      quoteListQuery({
                        status: listQuery.status,
                        q: listQuery.q,
                        page: listQuery.page - 1,
                      }),
                      { scroll: false }
                    );
                  }}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="gc-action"
                  disabled={totalPages === 0 || listQuery.page >= totalPages}
                  onClick={() => {
                    setLoading(true);
                    router.replace(
                      quoteListQuery({
                        status: listQuery.status,
                        q: listQuery.q,
                        page: listQuery.page + 1,
                      }),
                      { scroll: false }
                    );
                  }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
