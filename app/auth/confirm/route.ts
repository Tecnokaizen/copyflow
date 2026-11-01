import { createAuthCodeProbe } from "@/lib/auth/auth-code-probe";
import {
  CONFIRMED_COOKIE,
  confirmedCookieOptions,
  resolveConfirmOutcome,
} from "@/lib/auth/confirm-callback";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

// Handles both email link shapes: token_hash + type, and the PKCE code that
// Supabase returns after its own /verify step. A confirmed email without a
// session (another device, expired flow) goes to /auth/confirmed, with a
// short-lived cookie that the page requires.
// See lib/auth/confirm-callback.ts and lib/auth/auth-code-probe.ts.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const outcome = await resolveConfirmOutcome(
    searchParams,
    async () => (await createClient()).auth,
    createAuthCodeProbe({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      apiKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    })
  );

  if (outcome.emailConfirmedWithoutSession) {
    (await cookies()).set(
      CONFIRMED_COOKIE,
      "1",
      confirmedCookieOptions(
        process.env.VERCEL_ENV === "preview" ||
          process.env.NODE_ENV === "production"
      )
    );
  }

  redirect(outcome.destination);
}
