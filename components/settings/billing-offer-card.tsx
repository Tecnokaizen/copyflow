"use client";

import { useId, useState } from "react";

import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type BillingOfferView = {
  offer_id: string;
  plan_code: string;
  plan_name: string;
  anchored: boolean;
  redeem_by: string;
  terms: string[];
  terms_hash: string;
};

/**
 * A tenant billing offer: the exact terms computed on the server, an explicit
 * acceptance checkbox and one button. Nothing is charged from this page; the
 * button opens Stripe Checkout, which shows the same summary.
 */
export function BillingOfferCard({
  offer,
  busy,
  onAccept,
}: {
  offer: BillingOfferView;
  busy: boolean;
  onAccept: (offer: BillingOfferView) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const checkboxId = useId();

  return (
    <SectionCard title="Oferta para tu organización" bodyClassName="p-5 sm:p-6">
      <p className="text-sm font-medium">{offer.plan_name}</p>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {offer.terms.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex items-start gap-2">
        <Checkbox
          id={checkboxId}
          checked={accepted}
          disabled={busy}
          onCheckedChange={(value) => setAccepted(value === true)}
        />
        <label htmlFor={checkboxId} className="text-sm leading-tight">
          He leído y acepto estas condiciones.
        </label>
      </div>
      <div className="mt-4">
        <Button
          type="button"
          disabled={busy || !accepted}
          onClick={() => onAccept(offer)}
        >
          Aceptar y contratar {offer.plan_name}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        El pago se completa en Stripe, que muestra este mismo resumen antes de
        confirmar.
      </p>
    </SectionCard>
  );
}
