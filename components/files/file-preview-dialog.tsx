"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreviewUrlResponse } from "@/lib/files/client";
import { formatFileSize } from "@/lib/files/format";
import { isCurrentPreviewRequest } from "@/lib/files/preview";

export type PreviewTarget = {
  id: string;
  original_name: string;
  size_bytes: number;
};

type FilePreviewDialogProps = {
  file: PreviewTarget | null;
  downloading?: boolean;
  onClose: () => void;
  onDownload: () => void;
  loadPreview: (
    fileId: string,
    signal: AbortSignal,
  ) => Promise<PreviewUrlResponse>;
};

export function FilePreviewDialog({
  file,
  downloading = false,
  onClose,
  onDownload,
  loadPreview,
}: FilePreviewDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestIdRef = useRef(0);
  const fileId = file?.id ?? null;
  const [trackedId, setTrackedId] = useState<string | null>(fileId);
  const [loading, setLoading] = useState(Boolean(fileId));
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewUrlResponse | null>(null);

  if (fileId !== trackedId) {
    setTrackedId(fileId);
    setPreview(null);
    setError(null);
    setLoading(Boolean(fileId));
  }

  useEffect(() => {
    if (!fileId) return;

    const controller = new AbortController();
    const nextId = requestIdRef.current + 1;
    requestIdRef.current = nextId;

    void loadPreview(fileId, controller.signal)
      .then((result) => {
        if (
          !isCurrentPreviewRequest({
            requestId: nextId,
            activeId: requestIdRef.current,
            aborted: controller.signal.aborted,
          })
        ) {
          return;
        }
        setPreview(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (requestIdRef.current !== nextId) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se ha podido abrir la vista previa.",
        );
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [fileId, loadPreview]);

  useEffect(() => {
    if (!fileId) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fileId, onClose]);

  if (!file) return null;

  const meta = [
    preview?.kind === "pdf"
      ? "PDF"
      : preview?.kind === "image"
        ? "Imagen"
        : null,
    formatFileSize(file.size_bytes),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-lg sm:h-[min(80vh,820px)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-semibold">
              {file.original_name}
            </h2>
            {meta ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {meta}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDownload}
              disabled={downloading}
            >
              <Download className="size-4" />
              Descargar
            </Button>
            <Button
              ref={closeRef}
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Cerrar vista previa"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/40">
          {loading ? (
            <p
              className="px-5 py-10 text-sm text-muted-foreground"
              role="status"
            >
              Preparando vista previa…
            </p>
          ) : error ? (
            <p className="px-5 py-10 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : preview?.kind === "pdf" ? (
            <iframe
              title={file.original_name}
              src={preview.preview_url}
              className="h-full min-h-[60vh] w-full border-0 bg-white"
              referrerPolicy="no-referrer"
            />
          ) : preview?.kind === "image" ? (
            <div className="flex h-full min-h-[50vh] items-center justify-center p-4">
              {/* Signed R2 URLs expire and are not served through the image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.preview_url}
                alt={file.original_name}
                className="max-h-full max-w-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
