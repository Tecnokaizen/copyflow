import { createAuthCodeProbe } from "@/lib/auth/auth-code-probe";
import { resolveConfirmRedirect } from "@/lib/auth/confirm-callback";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

// Handles both email link shapes: token_hash + type, and the PKCE code that
// Supabase returns after its own /verify step. A confirmed email without a
// session (another device, expired flow) goes to /auth/confirmed.
// See lib/auth/confirm-callback.ts and lib/auth/auth-code-probe.ts.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const destination = await resolveConfirmRedirect(
    searchParams,
    async () => (await createClient()).auth,
    createAuthCodeProbe({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      apiKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    })
  );

  redirect(destination);
}
