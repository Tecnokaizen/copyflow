import type { StorePatch, StorePayload } from "@/lib/stores/types";
import { isUuid } from "@/lib/team/payload";

function normalizeOptionalText(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

function normalizeBoolean(
  value: unknown,
  fallback: boolean
): { ok: true; value: boolean } | { ok: false } {
  if (value == null) {
    return { ok: true, value: fallback };
  }

  if (typeof value === "boolean") {
    return { ok: true, value };
  }

  if (value === "true" || value === 1 || value === "1") {
    return { ok: true, value: true };
  }

  if (value === "false" || value === 0 || value === "0") {
    return { ok: true, value: false };
  }

  return { ok: false };
}

export function parseStoreCreatePayload(
  payload: Record<string, unknown>
): { ok: true; data: StorePayload } | { ok: false } {
  if (typeof payload.name !== "string") {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name) {
    return { ok: false };
  }

  const code = normalizeOptionalText(payload.code);
  const active = normalizeBoolean(payload.active, true);

  if (!code.ok || !active.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      name,
      code: code.value,
      active: active.value,
    },
  };
}

export function parseStorePatchPayload(
  payload: Record<string, unknown>
): { ok: true; data: StorePatch } | { ok: false } {
  const patch: StorePatch = {};
  let hasField = false;

  if ("name" in payload) {
    if (typeof payload.name !== "string") {
      return { ok: false };
    }

    const name = payload.name.trim();
    if (!name) {
      return { ok: false };
    }

    patch.name = name;
    hasField = true;
  }

  if ("code" in payload) {
    const code = normalizeOptionalText(payload.code);
    if (!code.ok) {
      return { ok: false };
    }

    patch.code = code.value;
    hasField = true;
  }

  if ("active" in payload) {
    const active = normalizeBoolean(payload.active, true);
    if (!active.ok) {
      return { ok: false };
    }

    patch.active = active.value;
    hasField = true;
  }

  if (!hasField) {
    return { ok: false };
  }

  return { ok: true, data: patch };
}

export function parseOptionalStoreId(
  value: unknown
): { ok: true; storeId: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, storeId: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, storeId: null };
  }

  if (!isUuid(trimmed)) {
    return { ok: false };
  }

  return { ok: true, storeId: trimmed };
}

export { isUuid };
