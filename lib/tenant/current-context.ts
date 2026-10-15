import { readCurrentAccess } from "@/lib/tenant/current-access";

export async function getCurrentContext() {
  const access = await readCurrentAccess();
  return access.ok ? access.context : null;
}
