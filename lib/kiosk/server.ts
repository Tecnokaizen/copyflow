import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseKioskGateway,
  type KioskRpcClient,
} from "./supabase-gateway";
import {
  admitKioskRequest,
  getKioskBootstrap,
  kioskInputFingerprint,
  submitKioskOrder,
} from "./service";
import type { KioskOrderInput } from "./payload";
import {
  createKioskCapability,
  type TrustedKioskContext,
} from "./trusted-request";

function createGateway() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Missing public Supabase configuration");
  }
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createSupabaseKioskGateway(client as unknown as KioskRpcClient);
}

function capabilityFor(
  context: TrustedKioskContext,
  authorization: {
    purpose: "bootstrap" | "admit" | "submit";
    binding: string;
  }
) {
  const secret = process.env.KIOSK_SIGNING_SECRET;
  if (!secret) {
    throw new Error("Missing Kiosk signing configuration");
  }
  return createKioskCapability(
    {
      ...context,
      issuedAt: Math.floor(Date.now() / 1000),
    },
    authorization,
    secret
  );
}

export async function loadKioskBootstrap(context: TrustedKioskContext) {
  return getKioskBootstrap(
    capabilityFor(context, {
      purpose: "bootstrap",
      binding: "bootstrap",
    }),
    createGateway()
  );
}

export async function admitKioskOrderRequest(
  context: TrustedKioskContext
) {
  return admitKioskRequest(
    capabilityFor(context, {
      purpose: "admit",
      binding: "request",
    }),
    createGateway()
  );
}

export async function createKioskOrder(
  context: TrustedKioskContext,
  permitId: string,
  input: KioskOrderInput
) {
  const fingerprint = kioskInputFingerprint(input);
  return submitKioskOrder(
    capabilityFor(context, {
      purpose: "submit",
      binding: `${permitId}|${input.submissionId}|${fingerprint}`,
    }),
    permitId,
    input,
    createGateway()
  );
}
