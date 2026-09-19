import {
  MAX_ORDER_FILE_BYTES,
  validateOrderFileInit,
} from "@/lib/files/validation";

/** Public DTO from GET /api/orders/:id/files (no storage_key / secrets). */
export type OrderFileDto = {
  id: string;
  original_name: string;
  content_type: string | null;
  size_bytes: number;
  status: "pending" | "ready";
  created_at: string;
  completed_at: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
};

export type ListOrderFilesResponse = {
  tenant: string;
  order_id: string;
  files: OrderFileDto[];
};

export type InitUploadResponse = {
  file_id: string;
  upload_url: string;
  required_headers: Record<string, string>;
  expires_at: string;
};

export type DownloadUrlResponse = {
  download_url: string;
  expires_at: string;
  filename: string;
  content_type: string;
};

export type UploadPhase =
  | "queued"
  | "initializing"
  | "uploading"
  | "completing"
  | "success"
  | "error";

export type UploadErrorKind = "init" | "put" | "complete" | "client" | null;

export type ClientUploadItem = {
  localId: string;
  file: File;
  phase: UploadPhase;
  progress: number;
  errorKind: UploadErrorKind;
  errorMessage: string | null;
  fileId: string | null;
};

export const ORDER_FILE_ACCEPT = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".txt",
  ".csv",
  ".rtf",
  ".zip",
  ".rar",
  ".7z",
  ".ai",
  ".eps",
  ".psd",
  ".indd",
  ".svg",
].join(",");

export { MAX_ORDER_FILE_BYTES };

export function mapInitValidationMessage(error: string, sizeBytes?: number): string {
  if (
    typeof sizeBytes === "number" &&
    sizeBytes > MAX_ORDER_FILE_BYTES
  ) {
    return "El archivo supera el máximo de 100 MB.";
  }
  switch (error) {
    case "Unsupported file type":
    case "Unsupported content type":
      return "Tipo de archivo no admitido.";
    case "Invalid file size":
      return sizeBytes !== undefined && sizeBytes <= 0
        ? "El archivo está vacío."
        : "El archivo supera el máximo de 100 MB.";
    case "Invalid content type":
      return "Tipo de archivo no válido.";
    default:
      return "No se puede subir este archivo.";
  }
}

export function prevalidateClientFile(file: File): string | null {
  const result = validateOrderFileInit({
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
  });
  if (result.ok) return null;
  return mapInitValidationMessage(result.error, file.size);
}

type ApiErrorBody = {
  error?: string;
  code?: string;
};

async function readApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
  } catch {
    // ignore non-JSON
  }
  return fallback;
}

export async function listOrderFiles(
  orderId: string,
  init?: RequestInit,
): Promise<OrderFileDto[]> {
  const response = await fetch(`/api/orders/${orderId}/files`, {
    ...init,
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      await readApiError(response, "No se han podido cargar los archivos."),
    );
  }

  const body = (await response.json()) as ListOrderFilesResponse;
  return Array.isArray(body.files) ? body.files : [];
}

export async function initOrderFileUpload(
  orderId: string,
  input: { filename: string; content_type: string; size_bytes: number },
): Promise<InitUploadResponse> {
  const response = await fetch(`/api/orders/${orderId}/files`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(
      await readApiError(response, "No se ha podido preparar la subida."),
    );
  }

  return (await response.json()) as InitUploadResponse;
}

export async function completeOrderFileUpload(
  orderId: string,
  fileId: string,
): Promise<void> {
  const response = await fetch(
    `/api/orders/${orderId}/files/${fileId}/complete`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(
      await readApiError(
        response,
        "El archivo se ha enviado pero no ha podido confirmarse.",
      ),
    );
  }
}

export async function requestOrderFileDownload(
  orderId: string,
  fileId: string,
): Promise<DownloadUrlResponse> {
  const response = await fetch(
    `/api/orders/${orderId}/files/${fileId}/download`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(
      await readApiError(
        response,
        "No se ha podido descargar el archivo. Inténtalo de nuevo.",
      ),
    );
  }

  return (await response.json()) as DownloadUrlResponse;
}

export async function deleteOrderFile(
  orderId: string,
  fileId: string,
): Promise<void> {
  const response = await fetch(`/api/orders/${orderId}/files/${fileId}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(
      await readApiError(response, "No se ha podido eliminar el archivo."),
    );
  }
}

/**
 * PUT binary directly to a presigned R2 URL with upload progress via XHR.
 * Does not route the body through Next.js.
 */
export function putFileToPresignedUrl(
  uploadUrl: string,
  file: Blob,
  requiredHeaders: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);

    for (const [key, value] of Object.entries(requiredHeaders)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (!event.lengthComputable || event.total <= 0) {
        onProgress(0);
        return;
      }
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error("No se ha podido subir el archivo."));
    };

    xhr.onerror = () => {
      reject(new Error("No se ha podido subir el archivo."));
    };

    xhr.onabort = () => {
      reject(new Error("Subida cancelada."));
    };

    xhr.send(file);
  });
}

export type UploadSingleCallbacks = {
  onPhase?: (phase: UploadPhase) => void;
  onProgress?: (percent: number) => void;
};

/**
 * Full client upload pipeline: INIT → PUT (R2) → COMPLETE.
 * On retry, always start a fresh INIT (do not reuse expired upload URLs).
 */
export async function uploadOrderFile(
  orderId: string,
  file: File,
  callbacks?: UploadSingleCallbacks,
): Promise<{ fileId: string }> {
  const clientError = prevalidateClientFile(file);
  if (clientError) {
    callbacks?.onPhase?.("error");
    throw Object.assign(new Error(clientError), { kind: "client" as const });
  }

  callbacks?.onPhase?.("initializing");
  callbacks?.onProgress?.(0);

  let init: InitUploadResponse;
  try {
    init = await initOrderFileUpload(orderId, {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    });
  } catch (err) {
    callbacks?.onPhase?.("error");
    const raw =
      err instanceof Error ? err.message : "No se ha podido preparar la subida.";
    const mapped = [
      "Unsupported file type",
      "Unsupported content type",
      "Invalid file size",
      "Invalid content type",
    ].includes(raw)
      ? mapInitValidationMessage(raw, file.size)
      : raw === "Could not create file" ||
          raw === "Could not create upload URL" ||
          raw === "Unauthorized or tenant access denied"
        ? "No se ha podido preparar la subida."
        : raw;
    throw Object.assign(new Error(mapped), { kind: "init" as const });
  }

  callbacks?.onPhase?.("uploading");

  try {
    await putFileToPresignedUrl(
      init.upload_url,
      file,
      init.required_headers ?? {},
      callbacks?.onProgress,
    );
  } catch (err) {
    callbacks?.onPhase?.("error");
    throw Object.assign(
      err instanceof Error
        ? err
        : new Error("No se ha podido subir el archivo."),
      { kind: "put" as const },
    );
  }

  callbacks?.onPhase?.("completing");

  try {
    await completeOrderFileUpload(orderId, init.file_id);
  } catch (err) {
    callbacks?.onPhase?.("error");
    throw Object.assign(
      err instanceof Error
        ? err
        : new Error(
            "El archivo se ha enviado pero no ha podido confirmarse.",
          ),
      { kind: "complete" as const },
    );
  }

  callbacks?.onPhase?.("success");
  callbacks?.onProgress?.(100);
  return { fileId: init.file_id };
}

const DEFAULT_UPLOAD_CONCURRENCY = 2;

/**
 * Upload multiple files with bounded concurrency (default 2).
 * Each file runs INIT → PUT → COMPLETE independently.
 */
export async function uploadOrderFilesConcurrent(
  orderId: string,
  files: File[],
  options?: {
    concurrency?: number;
    onItemUpdate?: (
      index: number,
      update: {
        phase: UploadPhase;
        progress: number;
        errorKind?: UploadErrorKind;
        errorMessage?: string | null;
        fileId?: string | null;
      },
    ) => void;
  },
): Promise<void> {
  const concurrency = Math.max(
    1,
    options?.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY,
  );
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      if (!file) continue;

      options?.onItemUpdate?.(index, {
        phase: "queued",
        progress: 0,
      });

      try {
        let lastProgress = 0;
        const result = await uploadOrderFile(orderId, file, {
          onPhase: (phase) => {
            options?.onItemUpdate?.(index, {
              phase,
              progress: phase === "uploading" ? lastProgress : lastProgress,
            });
          },
          onProgress: (progress) => {
            lastProgress = progress;
            options?.onItemUpdate?.(index, {
              phase: "uploading",
              progress,
            });
          },
        });
        options?.onItemUpdate?.(index, {
          phase: "success",
          progress: 100,
          fileId: result.fileId,
          errorKind: null,
          errorMessage: null,
        });
      } catch (err) {
        const kind =
          err && typeof err === "object" && "kind" in err
            ? ((err as { kind?: UploadErrorKind }).kind ?? "client")
            : "client";
        const message =
          err instanceof Error
            ? err.message
            : "No se ha podido subir el archivo.";
        options?.onItemUpdate?.(index, {
          phase: "error",
          progress: 0,
          errorKind: kind,
          errorMessage: message,
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

/** Trigger a browser download from a short-lived URL without persisting it. */
export function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
