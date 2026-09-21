import { hasMembershipRole, MANAGEMENT_ROLES } from "@/lib/auth/membership-roles";
import { MAX_ORDER_FILE_BYTES } from "@/lib/files/validation";

/** 1 MiB = 1,048,576 bytes */
export const BYTES_PER_MIB = 1_048_576;
/** 1 GiB = 1,073,741,824 bytes */
export const BYTES_PER_GIB = 1_073_741_824;

export const PLATFORM_MAX_FILE_BYTES = MAX_ORDER_FILE_BYTES;

export const MAX_FILE_BYTES_PRESETS = [
  10 * BYTES_PER_MIB,
  25 * BYTES_PER_MIB,
  50 * BYTES_PER_MIB,
  100 * BYTES_PER_MIB,
] as const;

export type TenantFilesSettings = {
  storage_limit_bytes: number | null;
  max_file_bytes: number;
  platform_max_file_bytes: number;
  file_count: number;
  reserved_bytes: number;
  ready_bytes: number;
  pending_bytes: number;
  quota_configured: boolean;
};

export function canManageFilesSettings(role: string | null | undefined) {
  return hasMembershipRole(role, MANAGEMENT_ROLES);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMaxFileBytes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value <= 0 || value > PLATFORM_MAX_FILE_BYTES) {
    return null;
  }
  return value;
}

export function resolveMaxFileBytesFromPreferences(
  preferences: unknown
): number {
  if (!isRecord(preferences)) {
    return PLATFORM_MAX_FILE_BYTES;
  }
  const filesV1 = preferences.files_v1;
  if (!isRecord(filesV1)) {
    return PLATFORM_MAX_FILE_BYTES;
  }
  const raw = filesV1.max_file_bytes;
  if (typeof raw === "number" && Number.isInteger(raw)) {
    if (raw > 0 && raw <= PLATFORM_MAX_FILE_BYTES) {
      return raw;
    }
    return PLATFORM_MAX_FILE_BYTES;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (parsed > 0 && parsed <= PLATFORM_MAX_FILE_BYTES) {
      return parsed;
    }
  }
  return PLATFORM_MAX_FILE_BYTES;
}

/** Merge files_v1.max_file_bytes without wiping neighboring preference keys. */
export function mergeFilesV1MaxFileBytes(
  preferences: unknown,
  maxFileBytes: number
): Record<string, unknown> {
  const current = isRecord(preferences) ? { ...preferences } : {};
  const existingFiles = isRecord(current.files_v1)
    ? { ...current.files_v1 }
    : {};
  if (typeof existingFiles.version !== "number") {
    existingFiles.version = 1;
  }
  existingFiles.max_file_bytes = maxFileBytes;
  current.files_v1 = existingFiles;
  return current;
}

export function formatBinaryStorage(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < BYTES_PER_MIB) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    const kib = bytes / 1024;
    return `${kib.toLocaleString("es-ES", {
      maximumFractionDigits: kib >= 10 ? 0 : 1,
    })} KiB`;
  }
  if (bytes < BYTES_PER_GIB) {
    const mib = bytes / BYTES_PER_MIB;
    return `${mib.toLocaleString("es-ES", {
      maximumFractionDigits: mib >= 10 ? 0 : 1,
    })} MiB`;
  }
  const gib = bytes / BYTES_PER_GIB;
  return `${gib.toLocaleString("es-ES", {
    maximumFractionDigits: gib >= 10 ? 0 : 2,
  })} GiB`;
}

export function availableStorageBytes(
  reservedBytes: number,
  storageLimitBytes: number | null
): number | null {
  if (storageLimitBytes === null) {
    return null;
  }
  return Math.max(0, storageLimitBytes - reservedBytes);
}

export function storageUsagePercent(
  reservedBytes: number,
  storageLimitBytes: number | null
): number | null {
  if (storageLimitBytes === null || storageLimitBytes <= 0) {
    return null;
  }
  return Math.min(
    100,
    Math.round((reservedBytes / storageLimitBytes) * 1000) / 10
  );
}

export function parseTenantFilesSettings(
  value: unknown
): TenantFilesSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  const storageLimit =
    value.storage_limit_bytes === null
      ? null
      : typeof value.storage_limit_bytes === "number"
        ? value.storage_limit_bytes
        : null;

  const maxFile = parseMaxFileBytes(value.max_file_bytes);
  if (maxFile === null) {
    return null;
  }

  const asNonNegInt = (raw: unknown): number | null => {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return null;
    }
    return Math.trunc(raw);
  };

  const fileCount = asNonNegInt(value.file_count);
  const reserved = asNonNegInt(value.reserved_bytes);
  const ready = asNonNegInt(value.ready_bytes);
  const pending = asNonNegInt(value.pending_bytes);
  if (
    fileCount === null ||
    reserved === null ||
    ready === null ||
    pending === null
  ) {
    return null;
  }

  return {
    storage_limit_bytes: storageLimit,
    max_file_bytes: maxFile,
    platform_max_file_bytes:
      typeof value.platform_max_file_bytes === "number"
        ? value.platform_max_file_bytes
        : PLATFORM_MAX_FILE_BYTES,
    file_count: fileCount,
    reserved_bytes: reserved,
    ready_bytes: ready,
    pending_bytes: pending,
    quota_configured:
      typeof value.quota_configured === "boolean"
        ? value.quota_configured
        : storageLimit !== null,
  };
}

export function maxFileBytesLabel(bytes: number): string {
  if (bytes % BYTES_PER_MIB === 0) {
    return `${bytes / BYTES_PER_MIB} MiB`;
  }
  return formatBinaryStorage(bytes);
}
