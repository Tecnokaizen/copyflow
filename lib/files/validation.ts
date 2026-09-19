export const MAX_ORDER_FILE_BYTES = 104_857_600; // 100 MiB
export const PUT_PRESIGN_TTL_SECONDS = 15 * 60;
export const GET_PRESIGN_TTL_SECONDS = 5 * 60;

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "tif",
  "tiff",
  "heic",
  "heif",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "txt",
  "csv",
  "rtf",
  "zip",
  "rar",
  "7z",
  "ai",
  "eps",
  "psd",
  "indd",
  "svg",
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "ps1",
  "msi",
  "sh",
  "bash",
  "apk",
  "com",
  "scr",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "xhtml",
]);

const BLOCKED_MIME_PREFIXES = ["text/html", "application/javascript", "text/javascript"];

const BLOCKED_MIME_EXACT = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/vnd.microsoft.portable-executable",
]);

export function sanitizeOriginalFilename(raw: unknown): string {
  if (typeof raw !== "string") {
    return "archivo";
  }

  let name = raw.trim();
  if (!name) {
    return "archivo";
  }

  // Strip path segments (Unix + Windows)
  name = name.replace(/\\/g, "/");
  const slash = name.lastIndexOf("/");
  if (slash >= 0) {
    name = name.slice(slash + 1);
  }

  // Drop control characters
  name = name.replace(/[\u0000-\u001f\u007f]/g, "");
  name = name.trim();

  if (!name || name === "." || name === "..") {
    return "archivo";
  }

  if (name.length > 255) {
    name = name.slice(0, 255);
  }

  return name || "archivo";
}

export function extensionOf(filename: string): string | null {
  const base = sanitizeOriginalFilename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

export function isBlockedExtension(ext: string | null): boolean {
  if (!ext) {
    return false;
  }
  return BLOCKED_EXTENSIONS.has(ext.toLowerCase());
}

export function isAllowedExtension(ext: string | null): boolean {
  if (!ext) {
    return false;
  }
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

export function normalizeContentType(raw: unknown): string | null {
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 200) {
    return null;
  }
  // Reject parameterized type with path traversal style junk
  const base = trimmed.split(";")[0]?.trim() ?? "";
  return base || null;
}

export function isBlockedContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  if (BLOCKED_MIME_EXACT.has(contentType)) {
    return true;
  }
  return BLOCKED_MIME_PREFIXES.some(
    (prefix) => contentType === prefix || contentType.startsWith(`${prefix};`)
  );
}

export type FileInitValidation =
  | {
      ok: true;
      filename: string;
      contentType: string | null;
      sizeBytes: number;
      extension: string;
    }
  | { ok: false; error: string };

export function validateOrderFileInit(input: {
  filename: unknown;
  content_type: unknown;
  size_bytes: unknown;
}): FileInitValidation {
  const filename = sanitizeOriginalFilename(input.filename);
  const extension = extensionOf(filename);

  if (!extension || isBlockedExtension(extension) || !isAllowedExtension(extension)) {
    return { ok: false, error: "Unsupported file type" };
  }

  if (
    typeof input.size_bytes !== "number" ||
    !Number.isInteger(input.size_bytes) ||
    input.size_bytes <= 0 ||
    input.size_bytes > MAX_ORDER_FILE_BYTES
  ) {
    return { ok: false, error: "Invalid file size" };
  }

  const contentType = normalizeContentType(input.content_type);
  if (input.content_type != null && input.content_type !== "" && contentType === null) {
    return { ok: false, error: "Invalid content type" };
  }
  if (isBlockedContentType(contentType)) {
    return { ok: false, error: "Unsupported content type" };
  }

  // octet-stream only if extension is allowlisted (already checked)
  return {
    ok: true,
    filename,
    contentType,
    sizeBytes: input.size_bytes,
    extension,
  };
}
