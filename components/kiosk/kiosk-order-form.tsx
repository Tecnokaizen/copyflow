"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  MessageCircle,
  ShieldCheck,
  Zap,
} from "lucide-react";
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
  { id: "service", label: "Servicio" },
  { id: "details", label: "Detalles" },
  { id: "contact", label: "Tus datos" },
  { id: "confirmation", label: "Confirmación" },
];

function ServiceArtwork({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid h-28 shrink-0 place-items-center overflow-hidden border-b",
        selected
          ? "border-primary/25 bg-primary/10"
          : "border-border/70 bg-muted/70",
      )}
    >
      <span className="absolute -left-4 -top-5 size-16 rounded-2xl bg-primary/10" />
      <span className="absolute -right-5 bottom-1 size-14 rotate-12 rounded-xl border border-primary/15 bg-card/90" />
      <span className="absolute bottom-3 left-5 size-8 rounded-md bg-primary/15" />
      <span
        className={cn(
          "relative grid size-14 place-items-center rounded-2xl shadow-sm",
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-card text-primary",
        )}
      >
        <FileText className="size-7" aria-hidden="true" />
      </span>
      {selected ? (
        <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="size-4" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

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
  const [step, setStep] = useState<KioskFormStep>("service");
  const [state, setState] = useState<KioskFormState>(() =>
    createKioskFormState(submissionId),
  );
  const [reference, setReference] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousScreen = useRef<string>("service");
  const screen = reference ? "success" : step;

  useEffect(() => {
    if (previousScreen.current !== screen) {
      headingRef.current?.focus();
      previousScreen.current = screen;
    }
  }, [screen]);

  function update<K extends keyof KioskFormState>(
    key: K,
    value: KioskFormState[K],
  ) {
    setState((current) => ({ ...current, [key]: value, error: null }));
  }

  function next() {
    if (!canAdvanceKioskStep(step, state)) {
      update("error", "Completa los campos obligatorios para continuar.");
      return;
    }
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
    update("error", null);
  }

  function back() {
    setStep(STEPS[Math.max(stepIndex - 1, 0)].id);
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
      const result = (await response.json().catch(() => null)) as {
        reference?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof result?.reference !== "string") {
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "No se pudo enviar la solicitud.",
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
            : "No se pudo enviar la solicitud.",
        ),
      );
    }
  }

  if (reference) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-primary/20 bg-card px-5 py-12 text-center shadow-sm sm:p-14">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
          <Check className="size-8" aria-hidden="true" />
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-6 text-3xl font-bold tracking-tight outline-none"
        >
          Solicitud recibida
        </h1>
        <p className="mt-3 text-muted-foreground">
          Hemos recibido tu solicitud correctamente.
        </p>
        <div className="mt-8 rounded-2xl border bg-background px-4 py-6">
          <p className="text-sm font-medium text-muted-foreground">
            Referencia
          </p>
          <p className="mt-2 break-words font-mono text-3xl font-bold tracking-wide text-primary">
            {reference}
          </p>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground sm:text-base">
          El equipo de {bootstrap.tenant.name} contactará contigo si necesita
          confirmar algún detalle.
        </p>
      </section>
    );
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const selectedService = bootstrap.services.find(
    (service) => service.id === state.serviceId,
  );

  return (
    <section aria-label="Solicita tu pedido">
      <ol
        className="mx-auto mb-10 grid max-w-2xl grid-cols-4 sm:mb-12"
        aria-label="Progreso"
      >
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className="relative flex flex-col items-center gap-2 text-center"
            aria-current={item.id === step ? "step" : undefined}
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-1/2 top-5 h-px w-full",
                  index <= stepIndex ? "bg-primary/50" : "bg-border",
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 grid size-10 place-items-center rounded-full border-4 border-muted text-sm font-semibold",
                index <= stepIndex
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {index < stepIndex ? <Check className="size-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-[0.6875rem] font-semibold sm:text-sm",
                index === stepIndex ? "text-primary" : "text-muted-foreground",
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ol>

      <div
        className={cn(
          step !== "service" &&
            "mx-auto max-w-2xl rounded-3xl border bg-card p-5 shadow-sm sm:p-8",
        )}
      >
        {step === "service" ? (
          <div>
            <div className="mb-7 text-center sm:mb-9">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary sm:text-sm">
                Tu pedido en solo unos pasos
              </p>
              <h1
                ref={headingRef}
                tabIndex={-1}
                id="service-heading"
                className="mx-auto mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight outline-none sm:text-4xl"
              >
                ¿Qué necesitas imprimir hoy?
              </h1>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                Selecciona un servicio para empezar
              </p>
            </div>
            <fieldset>
              <legend className="sr-only">Selecciona un servicio</legend>
              <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {bootstrap.services.map((service) => {
                  const selected = state.serviceId === service.id;
                  return (
                    <label key={service.id} className="relative cursor-pointer">
                      <input
                        type="radio"
                        name="service"
                        value={service.id}
                        checked={selected}
                        onChange={() => update("serviceId", service.id)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "flex h-full flex-col overflow-hidden rounded-2xl border-2 bg-card shadow-sm transition-[border-color,box-shadow,transform] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-muted",
                          selected
                            ? "border-primary bg-primary/[0.04] shadow-md"
                            : "border-border/80 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                        )}
                      >
                        <ServiceArtwork selected={selected} />
                        <span className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                          <span className="min-w-0 break-words text-base font-semibold leading-snug">
                            {service.name}
                          </span>
                          <ArrowRight
                            className={cn(
                              "size-5 shrink-0",
                              selected
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                            aria-hidden="true"
                          />
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === "contact" ? (
          <div className="grid gap-5">
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-bold tracking-tight outline-none"
              >
                Tus datos
              </h1>
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
                className="min-h-14 min-w-0 max-w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <Field label="Correo electrónico">
              <input
                type="email"
                autoComplete="email"
                value={state.email}
                maxLength={254}
                onChange={(event) => update("email", event.target.value)}
                className="min-h-14 min-w-0 max-w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                className="min-h-14 min-w-0 max-w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          </div>
        ) : null}

        {step === "details" ? (
          <div className="grid gap-5">
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-bold tracking-tight outline-none"
              >
                Cuéntanos qué necesitas
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Podrás revisar todos los datos antes de enviar.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Servicio seleccionado
                </p>
                <p className="mt-1 break-words font-semibold">
                  {selectedService?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep("service");
                  update("error", null);
                }}
                className="min-h-12 shrink-0 rounded-lg px-3 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cambiar
              </button>
            </div>
            <Field label="Descripción *">
              <textarea
                value={state.description}
                maxLength={4000}
                rows={5}
                onChange={(event) => update("description", event.target.value)}
                className="min-h-32 rounded-xl border bg-background p-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Cantidad, tamaño, acabado y cualquier detalle importante"
              />
            </Field>
            <Field label="Fecha deseada">
              <input
                type="datetime-local"
                value={state.dueAt}
                onChange={(event) => update("dueAt", event.target.value)}
                className="min-h-14 min-w-0 max-w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <Field label="Observaciones">
              <textarea
                value={state.observations}
                maxLength={2000}
                rows={3}
                onChange={(event) => update("observations", event.target.value)}
                className="min-h-24 rounded-xl border bg-background p-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
          </div>
        ) : null}

        {step === "confirmation" ? (
          <div className="grid gap-5">
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-bold tracking-tight outline-none"
              >
                Revisa tu solicitud
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Comprueba los datos antes de enviar tu solicitud.
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
                <div
                  key={label}
                  className="grid gap-1 p-4 sm:grid-cols-[9rem_1fr]"
                >
                  <dt className="text-sm font-semibold text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">
                    {value}
                  </dd>
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

        <div
          className={cn(
            step === "service"
              ? "mt-8 flex justify-center sm:mt-10"
              : "mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between",
          )}
        >
          {step !== "service" ? (
            <button
              type="button"
              onClick={back}
              disabled={state.submitting}
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border px-6 font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Atrás
            </button>
          ) : null}
          {step === "confirmation" ? (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={state.submitting}
              className="gc-cta min-h-14 gap-3 rounded-xl px-8 text-base font-semibold sm:min-w-52"
            >
              {state.submitting ? "Enviando…" : "Enviar solicitud"}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={!canAdvanceKioskStep(step, state)}
              className={cn(
                "gc-cta min-h-14 gap-3 rounded-xl px-8 text-base font-semibold",
                step === "service" ? "w-full sm:w-[300px]" : "sm:min-w-52",
              )}
            >
              Continuar
              <ArrowRight className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {step === "service" ? (
        <div className="mt-8 grid gap-6 rounded-3xl border border-border/70 bg-background/80 px-5 py-6 sm:mt-10 sm:grid-cols-3 sm:gap-8 sm:px-8 sm:py-8">
          {[
            {
              icon: Zap,
              title: "Rápido y sencillo",
              text: "Completa tu solicitud en pocos pasos.",
            },
            {
              icon: ShieldCheck,
              title: "Tus datos seguros",
              text: "Usaremos tus datos únicamente para gestionar tu pedido.",
            },
            {
              icon: MessageCircle,
              title: "¿Necesitas ayuda?",
              text: "Pregunta a nuestro equipo en mostrador.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {text}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
