"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { formatOrderMoney } from "@/lib/orders/money";

type ClientQuote = {
  id: string;
  reference: string;
  status_name: string | null;
  status_code: string | null;
  total: string | null;
  currency: string | null;
  issue_date: string | null;
  valid_until: string | null;
};

type QuotesPage = {
  page: number;
  total: number;
  has_more: boolean;
  quotes: ClientQuote[];
};

function formatCivil(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function ClientQuotes({ clientId }: { clientId: string }) {
  const [quotes, setQuotes] = useState<ClientQuote[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/quotes?page=1`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 403 || response.status === 404) {
          return { hidden: true as const };
        }
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "No se pudieron cargar los presupuestos");
        }
        return { hidden: false as const, body: body as QuotesPage };
      })
      .then((result) => {
        if (cancelled) return;
        if (result.hidden) {
          setHidden(true);
          return;
        }
        const parsed = result.body;
        setQuotes(parsed.quotes ?? []);
        setTotal(typeof parsed.total === "number" ? parsed.total : Number(parsed.total) || 0);
        setHasMore(parsed.has_more === true);
        setPage(1);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar los presupuestos");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (hidden) return null;
  if (loading) return <LoadingState label="Cargando presupuestos…" />;
  if (error) return <ErrorState title={error} />;

  return (
    <section className="mt-6 rounded-lg border bg-card p-6">
      <h2 className="mb-2 text-lg font-semibold">Presupuestos vinculados</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {total === 0 ? "Sin presupuestos" : `Mostrando ${quotes.length} de ${total}`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Referencia</th>
              <th className="px-4 py-3 text-left font-medium">Estado</th>
              <th className="px-4 py-3 text-left font-medium">Total</th>
              <th className="px-4 py-3 text-left font-medium">Emisión</th>
              <th className="px-4 py-3 text-left font-medium">Validez</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                  Este cliente todavía no tiene presupuestos.
                </td>
              </tr>
            ) : quotes.map((quote) => (
              <tr key={quote.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-4">
                  <Link href={`/quotes/${quote.id}`} className="font-medium hover:underline">
                    {quote.reference}
                  </Link>
                </td>
                <td className="px-4 py-4">{quote.status_name ?? "—"}</td>
                <td className="px-4 py-4">{quote.total ? formatOrderMoney(quote.total) : "—"}</td>
                <td className="px-4 py-4">{formatCivil(quote.issue_date)}</td>
                <td className="px-4 py-4">{formatCivil(quote.valid_until)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <div className="mt-4">
          <button
            type="button"
            className="gc-action"
            onClick={() => {
              void fetch(`/api/clients/${clientId}/quotes?page=${page + 1}`, { cache: "no-store" })
                .then(async (response) => {
                  const body = await response.json();
                  if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar los presupuestos");
                  const parsed = body as QuotesPage;
                  setQuotes((current) => [...current, ...(parsed.quotes ?? [])]);
                  setHasMore(parsed.has_more === true);
                  setPage(page + 1);
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : "No se pudieron cargar los presupuestos");
                });
            }}
          >
            Ver más
          </button>
        </div>
      ) : null}
    </section>
  );
}
