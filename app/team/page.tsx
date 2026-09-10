"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { TeamMemberForm } from "@/components/team/team-member-form";
import { TeamModal } from "@/components/team/team-modal";
import { canWriteTeam } from "@/lib/auth/membership-roles";
import {
  formToTeamPayload,
  memberToForm,
  type TeamListResponse,
  type TeamMember,
  type TeamMemberFormData,
} from "@/lib/team/types";

type ActiveFilter = "true" | "false" | "all";

function contactLines(member: TeamMember) {
  return [member.email, member.phone].filter(
    (item): item is string => Boolean(item && item.trim())
  );
}

export default function TeamPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ActiveFilter>("true");
  const [data, setData] = useState<TeamListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteTeam(context?.membership?.role));
      }
    }

    loadContext();
  }, []);

  useEffect(() => {
    async function loadTeam() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          active,
        });

        if (search) {
          params.set("search", search);
        }

        const response = await fetch(`/api/team?${params.toString()}`);
        const result = await response.json();

        if (!response.ok) {
          throw new Error("No se pudo cargar el equipo");
        }

        setData(result);
      } catch {
        setData(null);
        setError("No se pudo cargar el equipo");
      } finally {
        setLoading(false);
      }
    }

    loadTeam();
  }, [search, active, reloadToken]);

  async function refreshList() {
    const params = new URLSearchParams({
      active,
    });

    if (search) {
      params.set("search", search);
    }

    const response = await fetch(`/api/team?${params.toString()}`);
    const result = await response.json();
    if (response.ok) {
      setData(result);
    }
  }

  async function handleEdit(form: TeamMemberFormData) {
    if (!editing || saving) return;

    const parsed = formToTeamPayload(form);
    if (!parsed.ok) {
      setFormError("Revisa los datos del miembro.");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/team/${editing.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo actualizar el miembro");
      }

      setEditing(null);
      await refreshList();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el miembro"
      );
    } finally {
      setSaving(false);
    }
  }

  const members = data?.members ?? [];
  const hasListFilters = Boolean(search) || active !== "true";

  return (
    <>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Personal
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Equipo operativo del taller (no es la gestión de acceso SaaS).
          </p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>Miembros: {data?.total ?? 0}</span>
            <span>Disponibles: {data?.available_count ?? 0}</span>
            <span>Pedidos activos: {data?.active_orders_count ?? 0}</span>
          </div>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por nombre, rol o área..."
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
          <select
            value={active}
            onChange={(event) =>
              setActive(event.target.value as ActiveFilter)
            }
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        {loading ? (
          <LoadingState label="Cargando equipo..." />
        ) : error ? (
          <ErrorState
            title="No se pudo cargar el equipo"
            onRetry={() => setReloadToken((token) => token + 1)}
          />
        ) : members.length === 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <EmptyState
              title={
                hasListFilters
                  ? "No hay miembros con estos filtros"
                  : "No hay miembros todavía"
              }
              description={
                hasListFilters
                  ? "Prueba a cambiar la búsqueda o los filtros."
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">
                      Miembro
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Rol</th>
                    <th className="px-4 py-3 text-left font-medium">Área</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Pedidos activos
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Histórico
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Disponibilidad
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Estado
                    </th>
                    {canWrite && (
                      <th className="px-4 py-3 text-left font-medium">
                        Acción
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const contact = contactLines(member);

                    return (
                      <tr
                        key={member.id}
                        className="border-b last:border-b-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium">{member.name}</div>
                          {contact.map((line) => (
                            <div
                              key={line}
                              className="mt-1 text-xs text-muted-foreground"
                            >
                              {line}
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-4">
                          {member.job_title ?? "—"}
                        </td>
                        <td className="px-4 py-4">
                          {member.department ?? "—"}
                        </td>
                        <td className="px-4 py-4">
                          {member.active_orders_count}
                        </td>
                        <td className="px-4 py-4">
                          {member.total_orders_count}
                        </td>
                        <td className="px-4 py-4">
                          {member.can_receive_orders
                            ? "Disponible"
                            : "No disponible"}
                        </td>
                        <td className="px-4 py-4">
                          {member.active ? "Activo" : "Inactivo"}
                        </td>
                        {canWrite && (
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() => {
                                setFormError(null);
                                setEditing(member);
                              }}
                              className="rounded-md border bg-background px-3 py-2 text-sm"
                            >
                              Editar
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {editing && (
        <TeamModal>
          <TeamMemberForm
            key={editing.id}
            title="Editar miembro"
            initialValues={memberToForm(editing)}
            submitting={saving}
            error={formError}
            onCancel={() => {
              if (saving) return;
              setEditing(null);
            }}
            onSubmit={handleEdit}
          />
        </TeamModal>
      )}
    </>
  );
}
