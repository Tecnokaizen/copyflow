import type { createClient } from "@/lib/supabase/server";

type TenantClient = Awaited<ReturnType<typeof createClient>>;

export async function loadProfileNames(supabase: TenantClient, ids: string[]) {
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  return (data ?? []).flatMap((profile) => {
    if (typeof profile.id !== "string") {
      return [];
    }
    return [
      {
        id: profile.id,
        full_name: typeof profile.full_name === "string" ? profile.full_name : null,
      },
    ];
  });
}
