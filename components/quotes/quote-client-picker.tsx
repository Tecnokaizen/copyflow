"use client";
import { useState } from "react";
import { ClientSelector } from "@/components/clients/client-selector";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { EMPTY_CLIENT_FORM, formatCreateDuplicateMessage, mapClientSummary, parseClientDuplicate, toClientPayload,
  type ClientDuplicate, type ClientFormData, type ClientSummary } from "@/lib/clients/types";
export function QuoteClientPicker({ value, onChange, disabled }: { value: ClientSummary | null; onChange: (client: ClientSummary | null) => void; disabled: boolean }) {
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientFormInitial, setClientFormInitial] = useState(EMPTY_CLIENT_FORM);
  const [savingClient, setSavingClient] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientDuplicate, setClientDuplicate] = useState<ClientDuplicate | null>(null);

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

    onChange(summary);
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

      onChange(summary);
      setClientModalOpen(false);
    } catch (err) {
      setClientError(
        err instanceof Error ? err.message : "No se pudo crear el cliente"
      );
    } finally {
      setSavingClient(false);
    }
  }

  return <><ClientSelector value={value} onChange={onChange} allowNoClient disabled={disabled} onCreateNew={openCreateClient} />
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
</>;
}
