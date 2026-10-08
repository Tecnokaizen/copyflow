import Link from "next/link";
import { DraftSelect } from "@/components/orders/detail/order-field";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import {
  QUOTE_NOT_REQUIRED_LABEL,
  manualQuoteStatusOptions,
  type OrderQuoteSituation,
} from "@/lib/orders/quote-situation";
import type { ManagementOption } from "@/lib/orders/types";

/** Read-only value for "Producción · Presupuesto". */
export function OrderQuoteSituationValue({
  situation,
}: {
  situation: OrderQuoteSituation;
}) {
  if (situation.kind === "not_required") {
    return <span className="font-normal text-muted-foreground">{situation.label}</span>;
  }

  if (situation.kind === "manual") {
    return <QuoteStatusBadge name={situation.label} code={situation.code} />;
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <QuoteStatusBadge name={situation.label} code={situation.code} />
      <span className="text-sm font-normal text-muted-foreground">
        · {situation.detail} ·{" "}
        <Link
          href={`/quotes/${situation.quote.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {situation.quote.reference}
        </Link>
      </span>
    </span>
  );
}

/**
 * Edit-mode field. A value derived from the source quote is never editable
 * here; orders without source quote keep the manual tenant selector.
 */
export function OrderQuoteSituationField({
  situation,
  value,
  storedId,
  options,
  disabled,
  onChange,
}: {
  situation: OrderQuoteSituation;
  value: string | null;
  storedId: string | null;
  options: ReadonlyArray<ManagementOption> | null | undefined;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  if (situation.kind === "source") {
    return (
      <div className="space-y-1 py-1">
        <OrderQuoteSituationValue situation={situation} />
        <p className="text-xs font-normal text-muted-foreground">
          Se toma del presupuesto origen; no se edita aquí.
        </p>
      </div>
    );
  }

  return (
    <DraftSelect
      value={value ?? ""}
      disabled={disabled}
      onChange={(next) => onChange(next || null)}
    >
      <option value="">{QUOTE_NOT_REQUIRED_LABEL}</option>
      {manualQuoteStatusOptions(options, value ?? storedId).map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </DraftSelect>
  );
}
