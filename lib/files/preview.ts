import { contentDispositionInline } from "@/lib/files/access";
import { GET_PRESIGN_TTL_SECONDS } from "@/lib/files/validation";

export type PreviewKind = "pdf" | "image";

const PREVIEW_BY_EXTENSION: Record<
  string,
  { kind: PreviewKind; contentType: string }
> = {
  pdf: { kind: "pdf", contentType: "application/pdf" },
  jpg: { kind: "image", contentType: "image/jpeg" },
  jpeg: { kind: "image", contentType: "image/jpeg" },
  png: { kind: "image", contentType: "image/png" },
  webp: { kind: "image", contentType: "image/webp" },
  gif: { kind: "image", contentType: "image/gif" },
};

export type ResolvedPreview =
  | { previewable: true; kind: PreviewKind; contentType: string }
  | { previewable: false };

export function fileExtension(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Previewability comes from the filename extension, never from a client MIME. */
export function resolveFilePreview(filename: string): ResolvedPreview {
  const match = PREVIEW_BY_EXTENSION[fileExtension(filename)];
  if (!match) return { previewable: false };
  return { previewable: true, kind: match.kind, contentType: match.contentType };
}

export function isPreviewableFilename(filename: string): boolean {
  return resolveFilePreview(filename).previewable;
}

export type PreviewFileRecord = {
  original_name: string;
  content_type: string | null;
  status: string;
  deleted_at: string | null;
  storage_key: string;
};

export type PreviewHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

export function isCurrentPreviewRequest(input: {
  requestId: number;
  activeId: number;
  aborted: boolean;
}): boolean {
  return !input.aborted && input.requestId === input.activeId;
}

export async function runFilePreview(input: {
  accessDenied?: { status: number; body: Record<string, unknown> } | null;
  idsValid: boolean;
  parentFound: boolean;
  parentMissingError: string;
  file: PreviewFileRecord | null;
  presign: (args: {
    key: string;
    expiresIn: number;
    responseContentDisposition: string;
    responseContentType: string;
  }) => Promise<string>;
  now?: number;
}): Promise<PreviewHttpResult> {
  if (input.accessDenied) {
    return {
      status: input.accessDenied.status,
      body: input.accessDenied.body,
    };
  }

  if (!input.idsValid) {
    return { status: 404, body: { error: "File not found" } };
  }

  if (!input.parentFound) {
    return { status: 404, body: { error: input.parentMissingError } };
  }

  const file = input.file;
  if (!file || file.deleted_at) {
    return { status: 404, body: { error: "File not found" } };
  }

  if (file.status !== "ready") {
    return {
      status: 409,
      body: { error: "File not ready", code: "UPLOAD_INCOMPLETE" },
    };
  }

  const preview = resolveFilePreview(file.original_name);
  if (!preview.previewable) {
    return { status: 415, body: { error: "Preview not supported" } };
  }

  const disposition = contentDispositionInline(file.original_name);
  let previewUrl: string;
  try {
    previewUrl = await input.presign({
      key: file.storage_key,
      expiresIn: GET_PRESIGN_TTL_SECONDS,
      responseContentDisposition: disposition,
      responseContentType: preview.contentType,
    });
  } catch {
    return { status: 500, body: { error: "Could not create preview URL" } };
  }

  const issuedAt = input.now ?? Date.now();
  return {
    status: 200,
    body: {
      preview_url: previewUrl,
      expires_at: new Date(
        issuedAt + GET_PRESIGN_TTL_SECONDS * 1000,
      ).toISOString(),
      filename: file.original_name,
      content_type: preview.contentType,
      kind: preview.kind,
    },
  };
}
