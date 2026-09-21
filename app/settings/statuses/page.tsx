import { redirect } from "next/navigation";

export const instant = false;

/** Canonical route is /settings/order-statuses. */
export default function OrderStatusSettingsLegacyRedirectPage() {
  redirect("/settings/order-statuses");
}
