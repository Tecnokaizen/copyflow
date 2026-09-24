"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { operationalCreateVisibility } from "@/lib/quotes/workflow";
import { cn } from "@/lib/utils";

type OperationalCreateActionsProps = {
  primary?: "order" | "quote";
  onNewOrder?: () => void;
  newOrderDisabled?: boolean;
  className?: string;
  role?: string | null;
  quotesEnabled?: boolean;
};

export function OperationalCreateActions({
  primary = "order",
  onNewOrder,
  newOrderDisabled = false,
  className,
  role,
  quotesEnabled,
}: OperationalCreateActionsProps) {
  const accessProvided = role !== undefined && quotesEnabled !== undefined;
  const [fetchedVisibility, setFetchedVisibility] = useState<{
    order: boolean;
    quote: boolean;
  } | null>(null);

  useEffect(() => {
    if (accessProvided) {
      return;
    }

    let cancelled = false;

    fetch("/api/context")
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<{
          membership?: { role?: unknown };
          features?: { quotes?: unknown };
        }>;
      })
      .then((context) => {
        if (cancelled || !context) {
          return;
        }

        const membershipRole =
          typeof context.membership?.role === "string"
            ? context.membership.role
            : null;
        setFetchedVisibility(
          operationalCreateVisibility(
            membershipRole,
            context.features?.quotes === true
          )
        );
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedVisibility({ order: false, quote: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessProvided]);

  const visibility = accessProvided
    ? operationalCreateVisibility(role ?? null, quotesEnabled === true)
    : fetchedVisibility;

  if (!visibility || (!visibility.order && !visibility.quote)) {
    return null;
  }

  const orderClass = cn(
    "min-h-11 w-full sm:w-auto",
    primary === "order" ? "gc-cta" : "gc-action"
  );
  const quoteClass = cn(
    "min-h-11 w-full sm:w-auto",
    primary === "quote" ? "gc-cta" : "gc-action"
  );

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end",
        className
      )}
    >
      {visibility.order ? (
        onNewOrder ? (
          <button
            type="button"
            onClick={onNewOrder}
            disabled={newOrderDisabled}
            className={orderClass}
          >
            Nuevo pedido
          </button>
        ) : (
          <Link href="/orders?create=1" className={orderClass}>
            Nuevo pedido
          </Link>
        )
      ) : null}
      {visibility.quote ? (
        <Link href="/quotes/new" className={quoteClass}>
          Nuevo presupuesto
        </Link>
      ) : null}
    </div>
  );
}
