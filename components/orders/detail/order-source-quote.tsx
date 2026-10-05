import Link from "next/link";
import { SectionCard } from "@/components/gestcopy/section-card";
import { formatQuoteMoney } from "@/lib/quotes/editor";
import type { SourceQuote } from "@/lib/orders/types";
export function OrderSourceQuote({quote}:{quote:SourceQuote}) {
  return <SectionCard title="Presupuesto origen" bodyClassName="p-5 sm:p-6">
    <p className="font-medium">{quote.reference} · {formatQuoteMoney(quote.total,quote.currency)}</p>
    <p className="mt-2 text-sm text-muted-foreground">Aceptado · v{quote.version_number}</p>
    <Link className="gc-action mt-4 min-h-11" href={`/quotes/${quote.id}`}>Ver presupuesto</Link>
  </SectionCard>;
}
