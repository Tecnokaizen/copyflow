"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { WorkStageIcon } from "@/components/orders/work-stage-icon";
import {
  WorkStageEditorDialog,
  type WorkStageEditorTarget,
} from "@/components/settings/work-stages/work-stage-editor-dialog";
import { Button } from "@/components/ui/button";
import { fetchWorkStages, writeWorkStage } from "@/lib/orders/work-sequence/client";
import { reorderWorkStages } from "@/lib/orders/work-sequence/stage-order";
import { MAX_WORK_STAGES, type WorkStageDto } from "@/lib/orders/work-sequence/types";
import { cn } from "@/lib/utils";

const SUGGESTED = "Diseño, Preparación, Impresión y Acabado";

export function WorkStageSettings({ canManage }: { canManage: boolean }) {
  const [stages, setStages] = useState<WorkStageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<WorkStageEditorTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchWorkStages();
      setStages(list.stages);
    } catch (error) {
      if (!options.silent) setStages([]);
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar las fases de trabajo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function createSuggested() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const result = await writeWorkStage("POST", { suggested: true });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    if (result.list) setStages(result.list.stages);
    else await load({ silent: true });
  }

  async function saveEditor(values: { name: string; icon: string }) {
    if (!editor || saving) return;
    setSaving(true);
    setFormError(null);
    const result =
      editor.mode === "create"
        ? await writeWorkStage("POST", { name: values.name, icon: values.icon })
        : await writeWorkStage("PATCH", { id: editor.stage.id, name: values.name, icon: values.icon });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    setEditor(null);
    if (result.list) setStages(result.list.stages);
    else await load({ silent: true });
  }

  async function toggleActive(stage: WorkStageDto) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const result = await writeWorkStage("PATCH", { id: stage.id, active: !stage.active });
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    if (result.list) setStages(result.list.stages);
    else await load({ silent: true });
  }

  async function move(index: number, delta: -1 | 1) {
    if (busy) return;
    const { next, updates } = reorderWorkStages(stages, index, delta);
    if (updates.length === 0) return;
    setBusy(true);
    setActionError(null);
    setStages(next);
    for (const update of updates) {
      const result = await writeWorkStage("PATCH", update);
      if (!result.ok) {
        setActionError(result.error.message);
        break;
      }
    }
    setBusy(false);
    await load({ silent: true });
  }

  const openCreate = () => {
    setFormError(null);
    setEditor({ mode: "create", stage: null });
  };
  const full = stages.length >= MAX_WORK_STAGES;

  return (
    <>
      <SectionCard
        title="Fases"
        description="Cada paso de la secuencia de un pedido es una fase y una persona. Desactivar una fase la oculta al crear pasos nuevos, pero los pedidos que ya la usan la conservan. Las fases nunca se borran."
        actions={
          canManage && stages.length > 0 ? (
            <Button type="button" className="min-h-11 sm:min-h-9" onClick={openCreate} disabled={busy || full}>
              <Plus aria-hidden="true" />
              Nueva fase
            </Button>
          ) : null
        }
      >
        {!canManage ? (
          <p className="border-b border-border/70 px-5 py-3 text-sm text-muted-foreground sm:px-6">
            Solo lectura: el propietario, los administradores y los responsables pueden cambiar las fases.
          </p>
        ) : null}

        {actionError ? (
          <p className="border-b border-border/70 px-5 py-3 text-sm text-destructive sm:px-6" role="alert">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          <LoadingState label="Cargando fases…" />
        ) : loadError && stages.length === 0 ? (
          <ErrorState
            title="No se pudieron cargar las fases"
            description={loadError}
            onRetry={() => void load()}
          />
        ) : stages.length === 0 ? (
          <EmptyState
            title="Todavía no hay fases"
            description={
              canManage
                ? `Mientras no haya fases activas, la secuencia de trabajo no aparece en los pedidos. Puedes empezar con las sugeridas (${SUGGESTED}) y cambiarlas después.`
                : "Mientras no haya fases activas, la secuencia de trabajo no aparece en los pedidos."
            }
            action={
              canManage ? (
                <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                  <Button type="button" className="min-h-11" disabled={busy} onClick={() => void createSuggested()}>
                    <Sparkles aria-hidden="true" />
                    {busy ? "Creando…" : "Crear fases sugeridas"}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={openCreate}>
                    <Plus aria-hidden="true" />
                    Nueva fase
                  </Button>
                </div>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {stages.map((stage, index) => (
              <li
                key={stage.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-md border border-border",
                      stage.active ? "bg-card text-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <WorkStageIcon icon={stage.icon} decorative={false} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className={cn("truncate font-medium", !stage.active && "text-muted-foreground")}>
                      {stage.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "mr-2 inline-block rounded-full px-2 py-0.5 font-medium",
                          stage.active
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {stage.active ? "Activa" : "Inactiva"}
                      </span>
                      Posición {index + 1}
                    </p>
                  </div>
                </div>

                {canManage ? (
                  <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      disabled={busy || index === 0}
                      aria-label={`Subir «${stage.name}»`}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      disabled={busy || index === stages.length - 1}
                      aria-label={`Bajar «${stage.name}»`}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      disabled={busy}
                      onClick={() => void toggleActive(stage)}
                    >
                      {stage.active ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      disabled={busy}
                      onClick={() => {
                        setFormError(null);
                        setEditor({ mode: "edit", stage });
                      }}
                    >
                      <Pencil aria-hidden="true" />
                      Editar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage && full ? (
          <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground sm:px-6">
            Has llegado al máximo de {MAX_WORK_STAGES} fases. Edita o reactiva una existente.
          </p>
        ) : null}
      </SectionCard>

      {editor ? (
        <WorkStageEditorDialog
          key={editor.mode === "create" ? "create" : editor.stage.id}
          target={editor}
          saving={saving}
          error={formError}
          onCancel={() => {
            if (!saving) {
              setEditor(null);
              setFormError(null);
            }
          }}
          onSubmit={(values) => void saveEditor(values)}
        />
      ) : null}
    </>
  );
}
