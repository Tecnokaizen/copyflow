/** Pending monetary confirmation, isolated per tenant, user and order. */
export function paymentPendingStorageKey(
  tenantId: string,
  userId: string,
  orderId: string
) {
  if (!tenantId || !userId || !orderId) return null;
  if ([tenantId, userId, orderId].some((part) => part.includes(":"))) return null;
  return `gestcopy.payment-pending.v2:${tenantId}:${userId}:${orderId}`;
}
