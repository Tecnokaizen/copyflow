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
};

export function OperationalCreateActions({
  primary = "order",
  onNewOrder,
  newOrderDisabled = false,
  className,
}: OperationalCreateActionsProps) {
  const [visibility, setVisibility] = useState<{
    order: boolean;
    quote: boolean;
  } | null>(null);

  useEffect(() => {
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

        const role =
          typeof context.membership?.role === "string"
            ? context.membership.role
            : null;
        setVisibility(
          operationalCreateVisibility(role, context.features?.quotes === true)
        );
      })
      .catch(() => {
        if (!cancelled) {
          setVisibility({ order: false, quote: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
