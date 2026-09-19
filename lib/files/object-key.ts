const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildOrderFileStorageKey(input: {
  tenantId: string;
  orderId: string;
  fileId: string;
}): string {
  const { tenantId, orderId, fileId } = input;
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId) || !UUID_RE.test(fileId)) {
    throw new Error("Invalid id for storage key");
  }
  return `orders/${tenantId}/${orderId}/${fileId}`;
}

export function assertStorageKeyMatchesIds(
  storageKey: string,
  input: { tenantId: string; orderId: string; fileId: string }
): boolean {
  return storageKey === buildOrderFileStorageKey(input);
}
