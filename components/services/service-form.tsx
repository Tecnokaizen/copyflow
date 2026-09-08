"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  EMPTY_SERVICE_FORM,
  type ServiceCategory,
  type ServiceFormData,
} from "@/lib/services/types";

type ServiceFormProps = {
  title: string;
  initialValues?: ServiceFormData;
  currentCategoryName?: string | null;
  submitting?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (data: ServiceFormData) => void;
  onCancel: () => void;
};

const fieldClassName =
  "rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50";

export function ServiceForm({
  title,
  initialValues,
  currentCategoryName,
  submitting = false,
  error,
  submitLabel = "Guardar",
  onSubmit,
  onCancel,
}: ServiceFormProps) {
  const [form, setForm] = useState<ServiceFormData>(
    initialValues ?? EMPTY_SERVICE_FORM
  );
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  if (initialValues !== prevInitialValues) {
    setPrevInitialValues(initialValues);
    setForm(initialValues ?? EMPTY_SERVICE_FORM);
  }

  useEffect(() => {
    async function loadCategories() {
      try {
        const response = await fetch("/api/services/categories");
        const result = await response.json();
        if (response.ok) {
          setCategories(result.categories ?? []);
        }
      } finally {
        setCategoriesLoading(false);
      }
    }

    loadCategories();
  }, []);

  function updateField<K extends keyof ServiceFormData>(
    field: K,
    value: ServiceFormData[K]
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

  const categoryMissing =
    Boolean(form.category_id) &&
    !categories.some((category) => category.id === form.category_id);

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>

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
        Categoría
        <select
          value={form.category_id}
          disabled={submitting || categoriesLoading}
          onChange={(event) => updateField("category_id", event.target.value)}
          className={fieldClassName}
        >
          <option value="">— Sin categoría —</option>
          {categoryMissing && (
            <option value={form.category_id}>
              {currentCategoryName ?? "Categoría actual"}
            </option>
          )}
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        Descripción
        <textarea
          rows={3}
          value={form.description}
          disabled={submitting}
          onChange={(event) => updateField("description", event.target.value)}
          className={`w-full ${fieldClassName}`}
        />
      </label>

      <div className="grid gap-1 text-sm">
        Plazo estándar
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={form.lead_time_value}
            disabled={submitting}
            onChange={(event) =>
              updateField("lead_time_value", event.target.value)
            }
            className={fieldClassName}
          />
          <select
            value={form.lead_time_unit}
            disabled={submitting}
            onChange={(event) =>
              updateField(
                "lead_time_unit",
                event.target.value as ServiceFormData["lead_time_unit"]
              )
            }
            className={fieldClassName}
          >
            <option value="minutes">minutos</option>
            <option value="hours">horas</option>
            <option value="days">días</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.requires_file}
          disabled={submitting}
          onChange={(event) =>
            updateField("requires_file", event.target.checked)
          }
        />
        Requiere archivo
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.requires_design}
          disabled={submitting}
          onChange={(event) =>
            updateField("requires_design", event.target.checked)
          }
        />
        Requiere diseño
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.requires_quote}
          disabled={submitting}
          onChange={(event) =>
            updateField("requires_quote", event.target.checked)
          }
        />
        Requiere presupuesto
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          disabled={submitting}
          onChange={(event) => updateField("active", event.target.checked)}
        />
        Activo
      </label>

      <label className="grid gap-1 text-sm">
        Orden
        <input
          type="number"
          min="0"
          step="1"
          value={form.sort_order}
          disabled={submitting}
          onChange={(event) => updateField("sort_order", event.target.value)}
          className={fieldClassName}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
