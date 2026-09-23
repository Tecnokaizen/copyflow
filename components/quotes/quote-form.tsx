"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { ClientSelector } from "@/components/clients/client-selector";
import { Button } from "@/components/ui/button";
import {
  EMPTY_CLIENT_FORM,
  formatCreateDuplicateMessage,
  mapClientSummary,
  parseClientDuplicate,
  toClientPayload,
  type ClientDuplicate,
  type ClientFormData,
  type ClientSummary,
} from "@/lib/clients/types";

export type QuoteFormValues = {
  title: string;
  description: string;
  notes: string;
  validUntil: string;
  client: ClientSummary | null;
  serviceId: string;
  assigneeId: string;
};

type NamedOption = {
  id: string;
  name: string;
};

const fieldClassName =
  "min-h-11 w-full rounded-md border bg-background px-3 py-2 text-base";

export function QuoteForm({
  initial,
  submitting,
  error,
  submitLabel,
  onSubmit,
}: {
  initial: QuoteFormValues;
  submitting: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (values: QuoteFormValues) => void;
}) {
  const [values, setValues] = useState(initial);
  const [services, setServices] = useState<NamedOption[]>([]);
  const [members, setMembers] = useState<NamedOption[]>([]);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientFormInitial, setClientFormInitial] = useState(EMPTY_CLIENT_FORM);
  const [savingClient, setSavingClient] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientDuplicate, setClientDuplicate] = useState<ClientDuplicate | null>(null);

  useEffect(() => {
    async function loadOptions() {
      const [servicesResponse, teamResponse] = await Promise.all([
        fetch("/api/services?active=true&page_size=100"),
        fetch("/api/team?active=true&page_size=100"),
      ]);
      const servicesBody = await servicesResponse.json();
      const teamBody = await teamResponse.json();
      if (servicesResponse.ok && Array.isArray(servicesBody.services)) {
        setServices(
          servicesBody.services.filter(
            (item: NamedOption) => item?.id && item?.name
          )
        );
      }
      if (teamResponse.ok && Array.isArray(teamBody.members)) {
        setMembers(
          teamBody.members.filter((item: NamedOption) => item?.id && item?.name)
        );
      }
    }

    loadOptions();
  }, []);

  function openCreateClient(query: string) {
    setClientFormInitial({ ...EMPTY_CLIENT_FORM, name: query });
    setClientError(null);
    setClientDuplicate(null);
    setClientModalOpen(true);
  }

  async function selectClientById(clientId: string) {
    const response = await fetch(`/api/clients/${clientId}`);
    const result = await response.json();
    const summary = mapClientSummary(result.client);
    if (!response.ok || !summary) {
      throw new Error("No se pudo cargar el cliente");
    }

    setValues((current) => ({ ...current, client: summary }));
    setClientModalOpen(false);
    setClientError(null);
    setClientDuplicate(null);
  }

  async function saveNewClient(form: ClientFormData) {
    if (savingClient) {
      return;
    }

    setSavingClient(true);
    setClientError(null);
    setClientDuplicate(null);

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toClientPayload(form)),
      });
      const result = await response.json();

      if (response.status === 409 && result.code === "client_duplicate") {
        const duplicate = parseClientDuplicate(result.duplicate);
        setClientDuplicate(duplicate);
        setClientError(
          duplicate
            ? formatCreateDuplicateMessage(duplicate)
            : "Ya existe un cliente con estos datos."
        );
        return;
      }

      if (!response.ok) {
        throw new Error("No se pudo crear el cliente");
      }

      const summary = mapClientSummary(result.client);
      if (!summary) {
        throw new Error("No se pudo crear el cliente");
      }

      setValues((current) => ({ ...current, client: summary }));
      setClientModalOpen(false);
    } catch (err) {
      setClientError(
        err instanceof Error ? err.message : "No se pudo crear el cliente"
      );
    } finally {
      setSavingClient(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || values.description.trim() === "") {
      return;
    }

    onSubmit({
      ...values,
      title: values.title.trim(),
      description: values.description.trim(),
      notes: values.notes.trim(),
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Cliente</span>
          <ClientSelector
            value={values.client}
            onChange={(client) => setValues((current) => ({ ...current, client }))}
            allowNoClient
            onCreateNew={openCreateClient}
            disabled={submitting}
          />
        </div>

        <label className="grid gap-2 text-sm font-medium">
          Servicio
          <select
            className={fieldClassName}
            value={values.serviceId}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({ ...current, serviceId: event.target.value }))
            }
          >
            <option value="">Sin servicio</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Responsable
          <select
            className={fieldClassName}
            value={values.assigneeId}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                assigneeId: event.target.value,
              }))
            }
          >
            <option value="">Sin responsable</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Título
          <input
            className={fieldClassName}
            value={values.title}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Descripción
          <textarea
            className={`${fieldClassName} min-h-32`}
            required
            value={values.description}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Válido hasta
          <input
            type="date"
            className={fieldClassName}
            value={values.validUntil}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                validUntil: event.target.value,
              }))
            }
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Notas
          <textarea
            className={`${fieldClassName} min-h-24`}
            value={values.notes}
            disabled={submitting}
            onChange={(event) =>
              setValues((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </label>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting || !values.description.trim()}>
            {submitting ? "Guardando…" : submitLabel}
          </Button>
        </div>
      </form>

      {clientModalOpen ? (
        <ClientModal>
          <ClientForm
            title="Nuevo cliente"
            initialValues={clientFormInitial}
            submitting={savingClient}
            error={clientError}
            duplicate={clientDuplicate}
            submitLabel="Crear cliente"
            onSubmit={saveNewClient}
            onCancel={() => {
              if (!savingClient) {
                setClientModalOpen(false);
              }
            }}
            onUseDuplicate={(clientId) => {
              selectClientById(clientId).catch(() => {
                setClientError("No se pudo cargar el cliente");
              });
            }}
          />
        </ClientModal>
      ) : null}
    </>
  );
}
