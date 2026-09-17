"use client";

import { useState } from "react";
import {
  canAdvanceKioskStep,
  createKioskFormState,
  kioskSubmissionPayload,
  markKioskSubmissionFailed,
  type KioskFormState,
  type KioskFormStep,
} from "@/lib/kiosk/form-state";
import type { KioskBootstrapDto } from "@/lib/kiosk/service";
import { cn } from "@/lib/utils";

const STEPS: Array<{ id: KioskFormStep; label: string }> = [
  { id: "contact", label: "Contacto" },
  { id: "order", label: "Pedido" },
  { id: "confirmation", label: "Confirmación" },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-foreground">
      {label}
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function KioskOrderForm({
  bootstrap,
  submissionId,
}: {
  bootstrap: KioskBootstrapDto;
  submissionId: string;
}) {
  const [step, setStep] = useState<KioskFormStep>("contact");
  const [state, setState] = useState<KioskFormState>(() =>
    createKioskFormState(submissionId)
  );
  const [reference, setReference] = useState<string | null>(null);

  function update<K extends keyof KioskFormState>(
    key: K,
    value: KioskFormState[K]
  ) {
    setState((current) => ({ ...current, [key]: value, error: null }));
  }

  function next() {
    if (!canAdvanceKioskStep(step, state)) {
      update("error", "Completa los campos obligatorios para continuar.");
      return;
    }
    setStep(step === "contact" ? "order" : "confirmation");
    update("error", null);
  }

  function back() {
    setStep(step === "confirmation" ? "order" : "contact");
    update("error", null);
  }

  async function submit() {
    if (state.submitting) return;
    setState((current) => ({ ...current, submitting: true, error: null }));

    try {
      const response = await fetch("/api/kiosk/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kioskSubmissionPayload(state)),
      });
      const result = (await response.json().catch(() => null)) as
        | { reference?: unknown; error?: unknown }
        | null;
      if (!response.ok || typeof result?.reference !== "string") {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "No se pudo enviar la solicitud."
        );
      }
      setReference(result.reference);
      setState((current) => ({ ...current, submitting: false, error: null }));
    } catch (error) {
      setState((current) =>
        markKioskSubmissionFailed(
          current,
          error instanceof Error
            ? error.message
            : "No se pudo enviar la solicitud."
        )
      );
    }
  }

  if (reference) {
    return (
      <section
        className="rounded-2xl border border-primary/25 bg-card p-6 text-center shadow-sm sm:p-8"
        aria-live="polite"
      >
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
          ✓
        </div>
        <h2 className="mt-4 text-2xl font-bold">Solicitud recibida</h2>
        <p className="mt-2 text-muted-foreground">
          Hemos creado tu pedido con la referencia:
        </p>
        <p className="mt-3 font-mono text-xl font-bold tracking-wide">
          {reference}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          El equipo de {bootstrap.tenant.name} contactará contigo si necesita
          confirmar algún detalle.
        </p>
      </section>
    );
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const selectedService = bootstrap.services.find(
    (service) => service.id === state.serviceId
  );

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-7">
      <ol className="mb-7 grid grid-cols-3 gap-2" aria-label="Progreso">
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className={cn(
              "border-t-4 pt-2 text-center text-xs font-semibold sm:text-sm",
              index <= stepIndex
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground"
            )}
            aria-current={item.id === step ? "step" : undefined}
          >
            {item.label}
          </li>
        ))}
      </ol>

      {step === "contact" ? (
        <div className="grid gap-5">
          <div>
            <h2 className="text-xl font-bold">Tus datos de contacto</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Los usaremos únicamente para gestionar esta solicitud.
            </p>
          </div>
          <Field label="Nombre *">
            <input
              autoComplete="name"
              value={state.name}
              maxLength={120}
              onChange={(event) => update("name", event.target.value)}
              className="min-h-12 rounded-lg border bg-background px-3 text-base"
            />
          </Field>
          <Field label="Correo electrónico">
            <input
              type="email"
              autoComplete="email"
              value={state.email}
              maxLength={254}
              onChange={(event) => update("email", event.target.value)}
              className="min-h-12 rounded-lg border bg-background px-3 text-base"
            />
          </Field>
          <Field
            label="Teléfono"
            hint="Indica al menos un correo electrónico o un teléfono."
          >
            <input
              type="tel"
              autoComplete="tel"
              value={state.phone}
              maxLength={40}
              onChange={(event) => update("phone", event.target.value)}
              className="min-h-12 rounded-lg border bg-background px-3 text-base"
            />
          </Field>
        </div>
      ) : null}

      {step === "order" ? (
        <div className="grid gap-5">
          <div>
            <h2 className="text-xl font-bold">Cuéntanos qué necesitas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Podrás revisar todos los datos antes de enviar.
            </p>
          </div>
          <Field label="Servicio *">
            <select
              value={state.serviceId}
              onChange={(event) => update("serviceId", event.target.value)}
              className="min-h-12 rounded-lg border bg-background px-3 text-base"
            >
              <option value="">Selecciona un servicio</option>
              {bootstrap.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descripción *">
            <textarea
              value={state.description}
              maxLength={4000}
              rows={5}
              onChange={(event) => update("description", event.target.value)}
              className="min-h-32 rounded-lg border bg-background p-3 text-base"
              placeholder="Cantidad, tamaño, acabado y cualquier detalle importante"
            />
          </Field>
          <Field label="Fecha deseada">
            <input
              type="datetime-local"
              value={state.dueAt}
              onChange={(event) => update("dueAt", event.target.value)}
              className="min-h-12 rounded-lg border bg-background px-3 text-base"
            />
          </Field>
          <Field label="Observaciones">
            <textarea
              value={state.observations}
              maxLength={2000}
              rows={3}
              onChange={(event) => update("observations", event.target.value)}
              className="min-h-24 rounded-lg border bg-background p-3 text-base"
            />
          </Field>
          <div className="rounded-xl border border-dashed bg-muted/35 p-4">
            <p className="font-semibold">Archivos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              La subida de archivos estará disponible próximamente. El equipo
              te indicará cómo enviarlos.
            </p>
          </div>
        </div>
      ) : null}

      {step === "confirmation" ? (
        <div className="grid gap-5">
          <div>
            <h2 className="text-xl font-bold">Confirma tu solicitud</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Comprueba los datos antes de crear el pedido.
            </p>
          </div>
          <dl className="divide-y rounded-xl border">
            {[
              ["Contacto", state.name],
              ["Correo", state.email || "—"],
              ["Teléfono", state.phone || "—"],
              ["Servicio", selectedService?.name ?? "—"],
              ["Descripción", state.description],
              ["Fecha deseada", state.dueAt || "Sin fecha"],
              ["Observaciones", state.observations || "—"],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 p-4 sm:grid-cols-[9rem_1fr]">
                <dt className="text-sm font-semibold text-muted-foreground">
                  {label}
                </dt>
                <dd className="whitespace-pre-wrap text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <p
        className="mt-5 min-h-6 text-sm font-medium text-destructive"
        aria-live="polite"
      >
        {state.error}
      </p>

      <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step !== "contact" ? (
          <button
            type="button"
            onClick={back}
            disabled={state.submitting}
            className="min-h-12 rounded-lg border px-5 font-semibold hover:bg-muted disabled:opacity-60"
          >
            Atrás
          </button>
        ) : (
          <span />
        )}
        {step === "confirmation" ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state.submitting}
            className="min-h-12 rounded-lg bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {state.submitting ? "Enviando…" : "Crear pedido"}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="min-h-12 rounded-lg bg-primary px-6 font-semibold text-primary-foreground"
          >
            Continuar
          </button>
        )}
      </div>
    </section>
  );
}
