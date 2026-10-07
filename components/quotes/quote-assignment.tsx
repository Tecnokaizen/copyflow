"use client";

import { useEffect, useState } from "react";
import { ClientSelector } from "@/components/clients/client-selector";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import type { ClientSummary } from "@/lib/clients/types";
import type { QuoteRecord } from "@/lib/quotes/types";

export const ASSIGNMENT_LOCK_MESSAGE =
  "Guarda los cambios del presupuesto antes de modificar la asignación.";

const CLIENT_VERSION_LOCK_MESSAGE =
  "Una versión bloqueada requiere una nueva versión.";

type NamedOption = { id: string; name: string };

function selectorClient(client: QuoteRecord["client"]): ClientSummary | null {
  if (!client) return null;
  return {
    customer_type_id: null,
    customer_type_name: null,
    contact_name: null,
    company_name: null,
    tax_id: null,
    email: null,
    phone: null,
    notes: null,
    ...client,
  };
}

function useNamedOptions(url: string | null) {
  const [options, setOptions] = useState<NamedOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let active = true;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las opciones.");
        return response.json() as Promise<{ services?: NamedOption[]; members?: NamedOption[] }>;
      })
      .then((body) => {
        if (active) setOptions(body.services ?? body.members ?? []);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "No se pudieron cargar las opciones.");
      });
    return () => {
      active = false;
    };
  }, [url]);

  return { options, error };
}

export function QuoteClientService({
  quote,
  busy,
  assignmentLocked,
  clientLocked,
  onClientChange,
  onServiceChange,
}: {
  quote: QuoteRecord;
  busy: boolean;
  assignmentLocked: boolean;
  clientLocked: boolean;
  onClientChange: (client: ClientSummary | null) => void;
  onServiceChange: (serviceId: string | null) => void;
}) {
  const { options, error } = useNamedOptions("/api/services?active=true&page_size=100");
  const quoteServiceId = quote.service?.id ?? "";
  const [serviceId, setServiceId] = useState(quoteServiceId);
  const [sourceServiceId, setSourceServiceId] = useState(quoteServiceId);
  if (sourceServiceId !== quoteServiceId) {
    setSourceServiceId(quoteServiceId);
    setServiceId(quoteServiceId);
  }
  const clientDisabled = busy || assignmentLocked || clientLocked;
  const serviceDisabled = busy || assignmentLocked;

  return (
    <div className="mb-5 grid gap-4">
      <div className="gc-field">
        <span className="gc-field-label">Cliente asociado</span>
        <ClientSelector
          value={selectorClient(quote.client)}
          onChange={onClientChange}
          disabled={clientDisabled}
          allowNoClient
        />
        {assignmentLocked ? (
          <p className="text-sm text-muted-foreground">{ASSIGNMENT_LOCK_MESSAGE}</p>
        ) : clientLocked ? (
          <p className="text-sm text-muted-foreground">{CLIENT_VERSION_LOCK_MESSAGE}</p>
        ) : null}
      </div>
      <label className="gc-field sm:max-w-md">
        <span className="gc-field-label">Servicio</span>
        <select
          aria-label="Servicio"
          className="gc-field-control"
          disabled={serviceDisabled}
          value={serviceId}
          onChange={(event) => {
            const next = event.target.value;
            setServiceId(next);
            onServiceChange(next || null);
          }}
        >
          <option value="">Sin servicio</option>
          {quote.service && !options.some((option) => option.id === quote.service?.id) ? (
            <option value={quote.service.id}>{quote.service.name}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function QuoteAssigneeControl({
  assignee,
  busy,
  locked,
  onSave,
}: {
  assignee: QuoteRecord["assignee"];
  busy: boolean;
  locked: boolean;
  onSave: (memberId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(assignee?.id ?? "");
  const { options, error } = useNamedOptions(open ? "/api/team?active=true&page_size=100" : null);

  return (
    <>
      <span className="min-w-0 text-sm">
        · Responsable: {assignee?.name ?? "Sin asignar"}
      </span>
      <button
        type="button"
        className="gc-action min-h-11 shrink-0"
        disabled={busy || locked}
        title={locked ? ASSIGNMENT_LOCK_MESSAGE : undefined}
        onClick={() => {
          setMemberId(assignee?.id ?? "");
          setOpen(true);
        }}
      >
        Cambiar responsable
      </button>
      {open ? (
        <ConfirmDialog
          title="Cambiar responsable"
          description="El cambio se guarda al confirmar."
          confirmLabel="Guardar responsable"
          busy={busy}
          onCancel={() => {
            if (!busy) setOpen(false);
          }}
          onConfirm={() => {
            onSave(memberId || null);
            setOpen(false);
          }}
        >
          <label className="block text-sm font-medium text-foreground">
            Responsable
            <select
              aria-label="Responsable"
              className="gc-field-control mt-2"
              disabled={busy}
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">Sin asignar</option>
              {assignee && !options.some((option) => option.id === assignee.id) ? (
                <option value={assignee.id}>{assignee.name}</option>
              ) : null}
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
