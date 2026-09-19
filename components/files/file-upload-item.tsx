"use client";

import { Button } from "@/components/ui/button";
import type { ClientUploadItem } from "@/lib/files/client";
import { cn } from "@/lib/utils";

type FileUploadItemProps = {
  item: ClientUploadItem;
  onRetry?: () => void;
};

function phaseLabel(item: ClientUploadItem): string {
  switch (item.phase) {
    case "queued":
      return "En cola…";
    case "initializing":
      return "Preparando subida…";
    case "uploading":
      return `Subiendo… ${item.progress}%`;
    case "completing":
      return "Confirmando…";
    case "success":
      return "Listo";
    case "error":
      return item.errorMessage ?? "Error al subir";
    default:
      return "";
  }
}

export function FileUploadItem({ item, onRetry }: FileUploadItemProps) {
  const isError = item.phase === "error";
  const showBar =
    item.phase === "uploading" ||
    item.phase === "completing" ||
    item.phase === "initializing" ||
    item.phase === "queued";

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-border bg-card px-4 py-3",
        isError && "border-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {item.file.name}
          </p>
          <p
            className={cn(
              "mt-1 text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
            role={isError ? "alert" : undefined}
          >
            {phaseLabel(item)}
          </p>
        </div>
        {isError && onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onRetry}
          >
            Reintentar
          </Button>
        ) : null}
      </div>
      {showBar ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          aria-label={`Progreso de subida de ${item.file.name}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{
              width: `${
                item.phase === "queued" || item.phase === "initializing"
                  ? 4
                  : item.phase === "completing"
                    ? 100
                    : Math.max(item.progress, 4)
              }%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
