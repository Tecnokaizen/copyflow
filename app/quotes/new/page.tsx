"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { QuoteForm, type QuoteFormValues } from "@/components/quotes/quote-form";

const EMPTY_VALUES: QuoteFormValues = {
  title: "",
  description: "",
  notes: "",
  validUntil: "",
  client: null,
  serviceId: "",
  assigneeId: "",
};

export default function NewQuotePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(values: QuoteFormValues) {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (!response.ok || !result.quote?.id) {
        throw new Error(result.error ?? "No se pudo crear el presupuesto");
      }

      router.push(`/quotes/${result.quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el presupuesto");
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Nuevo presupuesto"
        description="Registra la solicitud. El número se asigna al guardar."
      />
      <SectionCard className="mx-auto max-w-3xl">
        <QuoteForm
          initial={EMPTY_VALUES}
          submitting={submitting}
          error={error}
          submitLabel="Guardar presupuesto"
          onSubmit={save}
        />
      </SectionCard>
    </AppShell>
  );
}
