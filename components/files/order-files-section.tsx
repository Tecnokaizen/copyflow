"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { DeleteFileDialog } from "@/components/files/delete-file-dialog";
import { FileDropzone } from "@/components/files/file-dropzone";
import { FileUploadItem } from "@/components/files/file-upload-item";
import { OrderFileRow } from "@/components/files/order-file-row";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import {
  type ClientUploadItem,
  type OrderFileDto,
  MAX_ORDER_FILE_BYTES,
  deleteOrderFile,
  formatMaxFileMiB,
  listOrderFiles,
  prevalidateClientFile,
  requestOrderFileDownload,
  triggerBrowserDownload,
  uploadOrderFile,
} from "@/lib/files/client";
import { formatFileSize } from "@/lib/files/format";
import {
  ORDER_UPLOAD_CONCURRENCY,
  SILENT_LIST_REFRESH_NOTICE,
  canApplyFilesUiUpdate,
  claimUploadLocalId,
  createConcurrencyGate,
  releaseUploadLocalId,
  resolveActionErrorOnListResult,
} from "@/lib/files/upload-queue";

export type OrderFilesApi = {
  list: typeof listOrderFiles;
  upload: typeof uploadOrderFile;
  remove: typeof deleteOrderFile;
  download: typeof requestOrderFileDownload;
};

const defaultFilesApi: OrderFilesApi = {
  list: listOrderFiles,
  upload: uploadOrderFile,
  remove: deleteOrderFile,
  download: requestOrderFileDownload,
};

type OrderFilesSectionProps = {
  orderId: string;
  canMutate: boolean;
  archived: boolean;
  onChanged?: () => void;
  filesApi?: OrderFilesApi;
  emptyTitle?: string;
  emptyDescription?: string;
  archivedMessage?: string;
  idleDescription?: string;
};

function newLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function OrderFilesSection({
  orderId,
  canMutate,
  archived,
  onChanged,
  filesApi = defaultFilesApi,
  emptyTitle = "Este pedido no tiene archivos adjuntos.",
  emptyDescription = "Adjunta documentos, artes finales, fotografías o materiales relacionados con este pedido.",
  archivedMessage = "Este pedido está archivado. Los archivos pueden consultarse y descargarse, pero ya no pueden modificarse.",
  idleDescription = "Documentos asociados al pedido",
}: OrderFilesSectionProps) {
  const [files, setFiles] = useState<OrderFileDto[]>([]);
  const [maxFileBytes, setMaxFileBytes] = useState(MAX_ORDER_FILE_BYTES);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showDropzone, setShowDropzone] = useState(false);
  const [uploads, setUploads] = useState<ClientUploadItem[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OrderFileDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const claimedUploadsRef = useRef(new Set<string>());
  const uploadGateRef = useRef(createConcurrencyGate(ORDER_UPLOAD_CONCURRENCY));
  const onChangedRef = useRef(onChanged);
  const toastId = useId();

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const alive = useCallback(
    (callbackOrderId: string) =>
      canApplyFilesUiUpdate({
        mounted: mountedRef.current,
        instanceOrderId: orderId,
        callbackOrderId,
      }),
    [orderId],
  );

  const refreshList = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      const requestOrderId = orderId;
      const controller = new AbortController();
      listAbortRef.current?.abort();
      listAbortRef.current = controller;

      if (!silent && alive(requestOrderId)) {
        setLoading(true);
        setListError(null);
      }

      try {
        const next = await filesApi.list(requestOrderId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || !alive(requestOrderId)) return;
        setFiles(next.files.filter((file) => file.status === "ready"));
        setMaxFileBytes(next.max_file_bytes);
        setListError(null);
        // Any successful LIST clears a prior silent-refresh notice
        // (including "Reintentar carga", which calls refreshList non-silent).
        const nextActionError = resolveActionErrorOnListResult({
          ok: true,
          silent,
        });
        if (nextActionError !== undefined) {
          setActionError(nextActionError);
        }
      } catch (err) {
        if (controller.signal.aborted || !alive(requestOrderId)) return;
        const message =
          err instanceof Error
            ? err.message
            : "No se han podido cargar los archivos.";
        const nextActionError = resolveActionErrorOnListResult({
          ok: false,
          silent,
        });
        if (nextActionError !== undefined) {
          setActionError(nextActionError);
          return;
        }
        setListError(message);
      } finally {
        if (!controller.signal.aborted && alive(requestOrderId)) {
          setLoading(false);
        }
      }
    },
    [alive, filesApi, orderId],
  );

  useEffect(() => {
    mountedRef.current = true;
    const requestOrderId = orderId;
    const controller = new AbortController();
    listAbortRef.current = controller;

    void filesApi.list(requestOrderId, { signal: controller.signal })
      .then((next) => {
        if (controller.signal.aborted || !alive(requestOrderId)) return;
        setFiles(next.files.filter((file) => file.status === "ready"));
        setMaxFileBytes(next.max_file_bytes);
        setListError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !alive(requestOrderId)) return;
        setListError(
          err instanceof Error
            ? err.message
            : "No se han podido cargar los archivos.",
        );
        setLoading(false);
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
      if (listAbortRef.current === controller) {
        listAbortRef.current = null;
      }
    };
  }, [alive, filesApi, orderId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totals = useMemo(() => {
    const count = files.length;
    const bytes = files.reduce((sum, file) => sum + (file.size_bytes || 0), 0);
    return { count, bytes };
  }, [files]);

  const description = archived
    ? archivedMessage
    : totals.count > 0
      ? `${totals.count} archivo${totals.count === 1 ? "" : "s"} · ${formatFileSize(totals.bytes)}`
      : idleDescription;

  function patchUpload(localId: string, patch: Partial<ClientUploadItem>) {
    if (!alive(orderId)) return;
    setUploads((prev) =>
      prev.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      ),
    );
  }

  function enqueueUpload(
    item: ClientUploadItem,
    opts?: { alreadyClaimed?: boolean },
  ) {
    if (!opts?.alreadyClaimed) {
      if (!claimUploadLocalId(claimedUploadsRef.current, item.localId)) {
        return;
      }
    }

    const capturedOrderId = orderId;

    void uploadGateRef.current.run(async () => {
      try {
        if (!alive(capturedOrderId)) return;

        const result = await filesApi.upload(capturedOrderId, item.file, {
          onPhase: (phase) => {
            if (!alive(capturedOrderId)) return;
            patchUpload(item.localId, {
              phase,
              ...(phase === "error"
                ? {}
                : { errorKind: null, errorMessage: null }),
            });
          },
          onProgress: (progress) => {
            if (!alive(capturedOrderId)) return;
            patchUpload(item.localId, { phase: "uploading", progress });
          },
        }, maxFileBytes);

        if (!alive(capturedOrderId)) return;

        patchUpload(item.localId, {
          phase: "success",
          progress: 100,
          fileId: result.fileId,
          errorKind: null,
          errorMessage: null,
        });

        await refreshList({ silent: true });
        if (alive(capturedOrderId)) {
          onChangedRef.current?.();
          setUploads((prev) =>
            prev.filter((row) => row.localId !== item.localId),
          );
        }
      } catch (err: unknown) {
        if (!alive(capturedOrderId)) return;
        const kind =
          err && typeof err === "object" && "kind" in err
            ? ((err as { kind?: ClientUploadItem["errorKind"] }).kind ??
              "client")
            : "client";
        const message =
          err instanceof Error
            ? err.message
            : "No se ha podido subir el archivo.";
        patchUpload(item.localId, {
          phase: "error",
          errorKind: kind,
          errorMessage: message,
        });
      } finally {
        releaseUploadLocalId(claimedUploadsRef.current, item.localId);
      }
    });
  }

  function startFiles(selected: File[]) {
    if (!canMutate || selected.length === 0) return;

    const nextItems: ClientUploadItem[] = [];
    for (const file of selected) {
      const clientError = prevalidateClientFile(file, maxFileBytes);
      const localId = newLocalId();
      if (clientError) {
        nextItems.push({
          localId,
          file,
          phase: "error",
          progress: 0,
          errorKind: "client",
          errorMessage: clientError,
          fileId: null,
        });
        continue;
      }
      nextItems.push({
        localId,
        file,
        phase: "queued",
        progress: 0,
        errorKind: null,
        errorMessage: null,
        fileId: null,
      });
    }

    setUploads((prev) => [...nextItems, ...prev]);
    setShowDropzone(true);
    setActionError(null);

    for (const item of nextItems) {
      if (item.phase === "error") continue;
      enqueueUpload(item);
    }
  }

  function retryUpload(localId: string) {
    const current = uploads.find((item) => item.localId === localId);
    if (!current || !canMutate) return;

    // Guard before any state update — double-click must not double INIT.
    if (!claimUploadLocalId(claimedUploadsRef.current, localId)) return;

    const clientError = prevalidateClientFile(current.file, maxFileBytes);
    if (clientError) {
      releaseUploadLocalId(claimedUploadsRef.current, localId);
      patchUpload(localId, {
        phase: "error",
        errorKind: "client",
        errorMessage: clientError,
      });
      return;
    }

    patchUpload(localId, {
      phase: "queued",
      progress: 0,
      errorKind: null,
      errorMessage: null,
      fileId: null,
    });
    enqueueUpload(
      {
        ...current,
        phase: "queued",
        progress: 0,
        errorKind: null,
        errorMessage: null,
        fileId: null,
      },
      { alreadyClaimed: true },
    );
  }

  async function handleDownload(file: OrderFileDto) {
    setActionError(null);
    setDownloadingId(file.id);
    const requestOrderId = orderId;
    try {
      const result = await filesApi.download(requestOrderId, file.id);
      if (!alive(requestOrderId)) return;
      triggerBrowserDownload(result.download_url, result.filename);
    } catch (err) {
      if (!alive(requestOrderId)) return;
      setActionError(
        err instanceof Error
          ? err.message
          : "No se ha podido descargar el archivo. Inténtalo de nuevo.",
      );
    } finally {
      if (alive(requestOrderId)) {
        setDownloadingId(null);
      }
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !canMutate) return;
    setDeleting(true);
    setActionError(null);
    const requestOrderId = orderId;
    const targetId = pendingDelete.id;
    try {
      await filesApi.remove(requestOrderId, targetId);
      if (!alive(requestOrderId)) return;
      setFiles((prev) => prev.filter((file) => file.id !== targetId));
      setPendingDelete(null);
      setToast("Archivo eliminado");
      onChangedRef.current?.();
    } catch (err) {
      if (!alive(requestOrderId)) return;
      setActionError(
        err instanceof Error
          ? err.message
          : "No se ha podido eliminar el archivo.",
      );
      setPendingDelete(null);
    } finally {
      if (alive(requestOrderId)) {
        setDeleting(false);
      }
    }
  }

  const headerActions =
    canMutate && !loading && !listError ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 w-full sm:w-auto"
        onClick={() => setShowDropzone((open) => !open)}
      >
        <Plus className="size-4" />
        Añadir archivos
      </Button>
    ) : null;

  return (
    <>
      <SectionCard
        title="Archivos"
        description={description}
        actions={headerActions}
        bodyClassName="px-0 py-0"
      >
        {canMutate && showDropzone ? (
          <div className="border-b border-border/70 px-4 py-4 sm:px-5">
            <FileDropzone
              onFilesSelected={startFiles}
              maxSizeLabel={formatMaxFileMiB(maxFileBytes)}
            />
          </div>
        ) : null}

        {uploads.length > 0 ? (
          <div className="space-y-2 border-b border-border/70 px-4 py-4 sm:px-5">
            {uploads.map((item) => (
              <FileUploadItem
                key={item.localId}
                item={item}
                onRetry={
                  item.phase === "error"
                    ? () => retryUpload(item.localId)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        {actionError ? (
          <div
            className="flex flex-col gap-2 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            role="alert"
          >
            <p className="text-sm text-destructive">{actionError}</p>
            {actionError === SILENT_LIST_REFRESH_NOTICE ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void refreshList()}
              >
                Reintentar carga
              </Button>
            ) : null}
          </div>
        ) : null}

        {toast ? (
          <div
            id={toastId}
            className="border-b border-border/70 px-4 py-2 text-sm text-muted-foreground sm:px-5"
            role="status"
            aria-live="polite"
          >
            {toast}
          </div>
        ) : null}

        {loading ? (
          <LoadingState label="Cargando archivos…" className="py-10" />
        ) : listError ? (
          <ErrorState
            title="No se han podido cargar los archivos"
            description={listError}
            onRetry={() => void refreshList()}
            className="py-10"
          />
        ) : files.length === 0 ? (
          <EmptyState
            title={archived ? emptyTitle : "Todavía no hay archivos"}
            description={archived ? undefined : emptyDescription}
            className="py-10"
            action={
              canMutate ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setShowDropzone(true)}
                >
                  <Plus className="size-4" />
                  Añadir archivos
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {files.map((file) => (
              <OrderFileRow
                key={file.id}
                file={file}
                canMutate={canMutate}
                downloading={downloadingId === file.id}
                onDownload={() => void handleDownload(file)}
                onDelete={
                  canMutate ? () => setPendingDelete(file) : undefined
                }
              />
            ))}
          </div>
        )}
      </SectionCard>

      {pendingDelete ? (
        <DeleteFileDialog
          filename={pendingDelete.original_name}
          busy={deleting}
          onCancel={() => {
            if (deleting) return;
            setPendingDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </>
  );
}
