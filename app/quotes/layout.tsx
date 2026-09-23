import { notFound } from "next/navigation";
import { tenantHasFeature } from "@/lib/features/tenant-has-feature";
import { canAccessQuotesModule, QUOTES_FEATURE_CODE } from "@/lib/quotes/access";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function QuotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getCurrentContext();
  if (!context) {
    notFound();
  }

  const supabase = await createClient();
  const enabled = await tenantHasFeature(
    supabase,
    context.tenant.id,
    QUOTES_FEATURE_CODE
  );

  if (!canAccessQuotesModule(context.membership.role, enabled)) {
    notFound();
  }

  return children;
}
