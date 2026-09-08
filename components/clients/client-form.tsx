"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  EMPTY_CLIENT_FORM,
  duplicateMatchLabels,
  type ClientDuplicate,
  type ClientFormData,
} from "@/lib/clients/types";

type CustomerTypeOption = {
  id: string;
  name: string;
};

type ClientFormProps = {
  title: string;
  initialValues?: ClientFormData;
  submitting?: boolean;
  error?: string | null;
  duplicate?: ClientDuplicate | null;
  submitLabel?: string;
  onSubmit: (data: ClientFormData) => void;
  onCancel: () => void;
  onUseDuplicate?: (clientId: string) => void;
  duplicateActionLabel?: string;
};

const fieldClassName =
  "rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50";

export function ClientForm({
  title,
  initialValues,
  submitting = false,
  error,
  duplicate,
  submitLabel = "Guardar",
  onSubmit,
  onCancel,
  onUseDuplicate,
  duplicateActionLabel = "Usar este cliente",
}: ClientFormProps) {
  const [form, setForm] = useState<ClientFormData>(
    initialValues ?? EMPTY_CLIENT_FORM
  );
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues);
  const [customerTypes, setCustomerTypes] = useState<CustomerTypeOption[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);

  if (initialValues !== prevInitialValues) {
    setPrevInitialValues(initialValues);
    setForm(initialValues ?? EMPTY_CLIENT_FORM);
  }

  useEffect(() => {
    async function loadTypes() {
      try {
        const response = await fetch("/api/clients/options");
        const result = await response.json();

        if (!response.ok) {
          return;
        }

        setCustomerTypes(result.customer_types ?? []);
      } finally {
        setTypesLoading(false);
      }
    }

    loadTypes();
  }, []);

  function updateField<K extends keyof ClientFormData>(
    field: K,
    value: ClientFormData[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (submitting || form.name.trim() === "") {
      return;
    }

    onSubmit(form);
  }

  const matchLabels = duplicate ? duplicateMatchLabels(duplicate) : [];

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>

      <label className="grid gap-1 text-sm">
        Tipo de cliente
        <select
          value={form.customer_type_id}
          disabled={submitting || typesLoading}
          onChange={(event) => {
            updateField("customer_type_id", event.target.value);
          }}
          className={fieldClassName}
        >
          <option value="">— Sin definir —</option>
          {customerTypes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        Nombre *
        <input
          type="text"
          value={form.name}
          disabled={submitting}
          onChange={(event) => updateField("name", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Persona de contacto
        <input
          type="text"
          value={form.contact_name}
          disabled={submitting}
          onChange={(event) => updateField("contact_name", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Empresa / razón social
        <input
          type="text"
          value={form.company_name}
          disabled={submitting}
          onChange={(event) => updateField("company_name", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        NIF / CIF
        <input
          type="text"
          value={form.tax_id}
          disabled={submitting}
          onChange={(event) => updateField("tax_id", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Email
        <input
          type="email"
          value={form.email}
          disabled={submitting}
          onChange={(event) => updateField("email", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Teléfono
        <input
          type="tel"
          value={form.phone}
          disabled={submitting}
          onChange={(event) => updateField("phone", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Notas
        <textarea
          rows={4}
          value={form.notes}
          disabled={submitting}
          onChange={(event) => updateField("notes", event.target.value)}
          className={`w-full ${fieldClassName}`}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {duplicate && matchLabels.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Coincidencia: {matchLabels.join(", ")}
          {duplicate.client_name ? ` · ${duplicate.client_name}` : ""}
        </p>
      )}

      {duplicate && onUseDuplicate && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => onUseDuplicate(duplicate.client_id)}
          className="justify-self-start rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          {duplicateActionLabel}
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || form.name.trim() === ""}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
