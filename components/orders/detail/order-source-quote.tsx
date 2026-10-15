import Link from "next/link";
import { formatQuoteMoney } from "@/lib/quotes/editor";
import type { SourceQuote } from "@/lib/orders/types";

export function OrderSourceQuote({ quote }: { quote: SourceQuote }) {
  const money = formatQuoteMoney(quote.total, quote.currency);

  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius)] border border-border/70 bg-card px-4 py-3 sm:px-5">
      <p className="min-w-0 text-sm leading-6 text-foreground">
        <span className="font-medium">Presupuesto origen</span>
        <span className="text-muted-foreground">
          {" "}
          · {quote.reference} · {money} · Aceptado · v{quote.version_number}
        </span>
      </p>
      <Link className="gc-action shrink-0" href={`/quotes/${quote.id}`}>
        Ver presupuesto
      </Link>
    </section>
  );
}
