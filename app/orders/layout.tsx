import { notFound } from "next/navigation";
import { canReadOperationalOverview } from "@/lib/orders/operational-access";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  const context = await getCurrentContext();
  if (!context || !canReadOperationalOverview(context.membership.role)) notFound();
  return children;
}
