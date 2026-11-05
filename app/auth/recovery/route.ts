import { resolveRecoveryRedirect } from "@/lib/auth/recovery-callback";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

// Password recovery email links land here, with a PKCE `code` or with
// `token_hash` + `type=recovery`. A valid link opens a session (cookie on this
// host only) and goes to /auth/update-password; anything else goes to
// /auth/forgot-password with the reason. See lib/auth/recovery-callback.ts.
export async function GET(request: NextRequest) {
  const destination = await resolveRecoveryRedirect(
    request.nextUrl.searchParams,
    async () => (await createClient()).auth
  );

  redirect(destination);
}
