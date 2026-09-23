import {
  type ClientUploadItem,
  completeOrderFileUpload,
  prevalidateClientFile,
  uploadOrderFile,
} from "./client";
import { createConcurrencyGate, ORDER_UPLOAD_CONCURRENCY } from "./upload-queue";

/** A form-owned queue. No storage or request is created until the order exists. */
export function createOrderUploadQueue(
  onChange: (items: ClientUploadItem[]) => void,
  transport = { upload: uploadOrderFile, complete: completeOrderFileUpload },
) {
  let items: ClientUploadItem[] = [];
  let running: Promise<boolean> | null = null;
  let boundOrderId: string | null = null;
  const gate = createConcurrencyGate(ORDER_UPLOAD_CONCURRENCY);

  function publish(next: ClientUploadItem[]) {
    items = next;
    onChange(items);
  }

  function patch(localId: string, values: Partial<ClientUploadItem>) {
    publish(items.map((item) => item.localId === localId ? { ...item, ...values } : item));
  }

  return {
    snapshot: () => items,
    add(files: File[], maxFileBytes: number) {
      if (running || boundOrderId) return;
      publish([...items, ...files.map((file): ClientUploadItem => {
        const error = prevalidateClientFile(file, maxFileBytes);
        return {
          localId: crypto.randomUUID(), file, phase: error ? "error" : "queued",
          progress: 0, errorKind: error ? "client" : null,
          errorMessage: error, fileId: null,
        };
      })]);
    },
    remove(localId: string) {
      if (running) return;
      publish(items.filter((item) => item.localId !== localId));
    },
    clear() {
      if (running) return;
      boundOrderId = null;
      publish([]);
    },
    upload(orderId: string, maxFileBytes: number): Promise<boolean> {
      // Keep a queue tied to its first order, including after a partial failure.
      if (!orderId || (boundOrderId && boundOrderId !== orderId)) {
        return Promise.reject(new Error("La cola pertenece a otro pedido."));
      }
      if (running) return running;
      boundOrderId = orderId;
      running = Promise.all(items.filter((item) => item.phase !== "success").map((item) => gate.run(async () => {
        patch(item.localId, { phase: "queued", errorKind: null, errorMessage: null });
        try {
          let fileId = item.fileId;
          if (item.errorKind === "complete" && fileId) {
            // COMPLETE is idempotent: a lost response must not upload a second copy.
            patch(item.localId, { phase: "completing" });
            await transport.complete(orderId, fileId);
          } else {
            const result = await transport.upload(orderId, item.file, {
              onPhase: (phase) => patch(item.localId, { phase }),
              onProgress: (progress) => patch(item.localId, { progress }),
            }, maxFileBytes);
            fileId = result.fileId;
          }
          patch(item.localId, { phase: "success", progress: 100, fileId });
        } catch (error) {
          const detail = error as { kind?: ClientUploadItem["errorKind"]; fileId?: string };
          patch(item.localId, {
            phase: "error", errorKind: detail?.kind ?? (item.fileId ? "complete" : "client"),
            fileId: detail?.fileId ?? item.fileId,
            errorMessage: error instanceof Error ? error.message : "No se ha podido subir el archivo.",
          });
        }
      }))).then(() => items.every((item) => item.phase === "success"))
        .finally(() => { running = null; });
      return running;
    },
  };
}
