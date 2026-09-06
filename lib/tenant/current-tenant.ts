import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSubdomainFromHostname } from "./hostname";

export async function getCurrentTenant() {
  const headersList = await headers();

  const hostname =
    headersList.get("x-forwarded-host") ??
    headersList.get("host") ??
    "";

  const slug = getSubdomainFromHostname(hostname);

  if (!slug) {
    return null;
  }

  const supabase = await createClient();

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (error || !tenant) {
    return null;
  }

  return tenant;
}