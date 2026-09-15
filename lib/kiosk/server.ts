import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseKioskRepository } from "./supabase-repository";
import {
  getKioskBootstrap,
  submitKioskOrder,
} from "./service";
import type { KioskOrderInput } from "./payload";

export async function loadKioskBootstrap(tenantSlug: string | null) {
  const repository = createSupabaseKioskRepository(createAdminClient());
  return getKioskBootstrap(tenantSlug, repository);
}

export async function createKioskOrder(
  tenantSlug: string,
  input: KioskOrderInput
) {
  const repository = createSupabaseKioskRepository(createAdminClient());
  return submitKioskOrder(tenantSlug, input, repository);
}
