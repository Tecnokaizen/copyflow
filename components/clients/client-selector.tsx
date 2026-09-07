"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientSummary } from "@/lib/clients/types";

export type { ClientSummary };

type ClientSelectorProps = {
  value: ClientSummary | null;
  onChange: (client: ClientSummary | null) => void;
  disabled?: boolean;
  allowNoClient?: boolean;
  onCreateNew?: (query: string) => void;
  initiallyOpen?: boolean;
};

const inputClassName =
  "w-full rounded-md border bg-background px-3 py-2 text-sm";

function resultLines(client: ClientSummary) {
  return [
    client.company_name,
    client.contact_name,
    client.email,
    client.phone,
    client.tax_id,
    client.customer_type_name,
  ].filter((item): item is string => Boolean(item && item.trim()));
}

function CompactSummary({ client }: { client: ClientSummary }) {
  const extra = resultLines(client).slice(0, 3);

  return (
    <div>
      <div className="text-sm font-medium">{client.name}</div>
      {extra.length > 0 && (
        <div className="mt-1 text-sm text-muted-foreground">
          {extra.join(" · ")}
        </div>
      )}
    </div>
  );
}

export function ClientSelector({
  value,
  onChange,
  disabled = false,
  allowNoClient = false,
  onCreateNew,
  initiallyOpen = false,
}: ClientSelectorProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(initiallyOpen);
  const [switching, setSwitching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ClientSummary[]>([]);
  const requestIdRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || disabled) {
      return;
    }

    const handle = window.setTimeout(async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: "10",
        });
        const trimmed = query.trim();
        if (trimmed) {
          params.set("search", trimmed);
        }

        const response = await fetch(`/api/clients?${params.toString()}`);
        const result = await response.json();

        if (requestId !== requestIdRef.current) {
          return;
        }

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudieron buscar clientes");
        }

        setResults(Array.isArray(result.clients) ? result.clients : []);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setResults([]);
        setError(
          err instanceof Error ? err.message : "Error al buscar clientes"
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(handle);
    };
  }, [query, open, disabled]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setSwitching(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const showSearch = !value || switching;

  if (!showSearch && value) {
    return (
      <div className="rounded-md border bg-background px-3 py-2">
        <CompactSummary client={value} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setQuery("");
              setSwitching(true);
              setOpen(true);
            }}
            className="rounded-md border bg-background px-3 py-1 text-sm disabled:opacity-50"
          >
            Cambiar
          </button>
          {allowNoClient && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setQuery("");
                setOpen(false);
                setSwitching(false);
                onChange(null);
              }}
              className="rounded-md border bg-background px-3 py-1 text-sm disabled:opacity-50"
            >
              Quitar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        value={query}
        disabled={disabled}
        autoFocus={initiallyOpen}
        placeholder="Buscar cliente por nombre, empresa, contacto, email, teléfono, NIF/CIF..."
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        className={inputClassName}
      />

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-background shadow-sm">
          {allowNoClient && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onChange(null);
                setOpen(false);
                setSwitching(false);
                setQuery("");
              }}
            >
              Sin cliente
            </button>
          )}

          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Buscando...
            </div>
          )}

          {error && (
            <div className="px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Sin coincidencias
            </div>
          )}

          {results.map((client) => (
            <button
              key={client.id}
              type="button"
              className="block w-full border-t px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                onChange(client);
                setOpen(false);
                setSwitching(false);
                setQuery("");
              }}
            >
              <div className="text-sm font-medium">{client.name}</div>
              {resultLines(client).length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {resultLines(client).join(" · ")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {onCreateNew && (
        <button
          type="button"
          disabled={disabled}
          className="mt-2 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => {
            onCreateNew(query.trim());
            setOpen(false);
            setSwitching(false);
          }}
        >
          + Crear nuevo cliente
        </button>
      )}
    </div>
  );
}
