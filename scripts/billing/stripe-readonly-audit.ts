/**
 * Read-only Stripe audit (Live or Test). Only GET requests; never prints the
 * key, customer data or card data. Each section says ok, or which permission
 * the key lacks, so a restricted key shows what it cannot see.
 *
 *   STRIPE_SECRET_KEY=rk_live_… npx tsx scripts/billing/stripe-readonly-audit.ts \
 *     [--app-origin https://app.gestcopy.com] [--since 2026-09-01]
 *
 * Restricted key permissions it needs (all Read): Accounts (Connect → Account
 * or "All core resources" read), Balance, Charges, Checkout Sessions, Coupons,
 * Customer portal, Prices, Products, Subscriptions, Webhook Endpoints.
 */

import Stripe from "stripe";

const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

type Section = Record<string, unknown>;

async function section(fn: () => Promise<Section>): Promise<Section> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    const e = error as { statusCode?: number; code?: string; message?: string };
    return {
      ok: false,
      status: e.statusCode ?? null,
      code: e.code ?? null,
      // Stripe names the missing permission in the message; no secrets in it.
      message: (e.message ?? "unknown")
        .replace(/\b(sk|rk)_(live|test)_[A-Za-z0-9*]+/g, "<key>")
        .slice(0, 300),
    };
  }
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  const keyKind = secret.split("_").slice(0, 2).join("_"); // e.g. rk_live
  const appOrigin = (flag("--app-origin") ?? "https://app.gestcopy.com").replace(/\/$/, "");
  const sinceIso = flag("--since") ?? "2026-09-01";
  const since = Math.floor(Date.parse(`${sinceIso}T00:00:00Z`) / 1000);
  if (!Number.isFinite(since)) {
    throw new Error("--since must be YYYY-MM-DD");
  }
  const stripe = new Stripe(secret, { apiVersion: "2026-08-26.dahlia" });
  const webhookUrl = `${appOrigin}/api/webhooks/stripe`;

  const report = {
    key_kind: keyKind,
    audited_at: new Date().toISOString(),
    account: await section(async () => {
      const a = await stripe.accounts.retrieveCurrent();
      return {
        id: a.id,
        country: a.country,
        default_currency: a.default_currency,
        business_type: a.business_type,
        business_name: a.business_profile?.name ?? a.settings?.dashboard?.display_name ?? null,
        charges_enabled: a.charges_enabled,
        payouts_enabled: a.payouts_enabled,
        details_submitted: a.details_submitted,
        requirements: {
          currently_due: a.requirements?.currently_due?.length ?? null,
          past_due: a.requirements?.past_due?.length ?? null,
          disabled_reason: a.requirements?.disabled_reason ?? null,
        },
      };
    }),
    balance: await section(async () => {
      const b = await stripe.balance.retrieve();
      return {
        livemode: b.livemode,
        available: b.available.map((x) => `${x.amount} ${x.currency}`),
        pending: b.pending.map((x) => `${x.amount} ${x.currency}`),
      };
    }),
    webhooks: await section(async () => {
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      const endpoints = list.data.map((w) => {
        const all = w.enabled_events.includes("*");
        return {
          id: w.id,
          url: w.url,
          status: w.status,
          api_version: w.api_version,
          missing_events: all
            ? []
            : REQUIRED_EVENTS.filter((e) => !w.enabled_events.includes(e)),
        };
      });
      const app = endpoints.filter((w) => w.url === webhookUrl);
      return {
        expected_url: webhookUrl,
        app_endpoints: app.length,
        app_endpoint_ready: app.some((w) => w.status === "enabled" && w.missing_events.length === 0),
        endpoints,
      };
    }),
    catalog: await section(async () => {
      const products = await stripe.products.list({ limit: 100 });
      const gestcopy = products.data.filter((p) => p.metadata?.gestcopy_plan_code);
      const rows = [];
      for (const p of gestcopy) {
        const prices = await stripe.prices.list({ product: p.id, limit: 20 });
        rows.push({
          plan_code: p.metadata.gestcopy_plan_code,
          product: p.id,
          name: p.name,
          active: p.active,
          prices: prices.data.map((x) => ({
            id: x.id,
            unit_amount: x.unit_amount,
            currency: x.currency,
            interval: x.recurring?.interval ?? null,
            active: x.active,
          })),
        });
      }
      return { products_total: products.data.length, gestcopy: rows };
    }),
    coupons: await section(async () => {
      const list = await stripe.coupons.list({ limit: 100 });
      const rows = [];
      for (const c of list.data.filter((x) => x.id.startsWith("gestcopy-"))) {
        const full = await stripe.coupons.retrieve(c.id, { expand: ["applies_to"] });
        rows.push({
          id: full.id,
          valid: full.valid,
          amount_off: full.amount_off,
          currency: full.currency,
          duration: full.duration,
          duration_in_months: full.duration_in_months,
          max_redemptions: full.max_redemptions,
          times_redeemed: full.times_redeemed,
          redeem_by: full.redeem_by ? new Date(full.redeem_by * 1000).toISOString() : null,
          applies_to: full.applies_to?.products ?? null,
        });
      }
      return { coupons_total: list.data.length, gestcopy: rows };
    }),
    portal: await section(async () => {
      const list = await stripe.billingPortal.configurations.list({ limit: 100 });
      return {
        configurations: list.data.map((c) => ({
          id: c.id,
          active: c.active,
          is_default: c.is_default,
          plan_changes: c.features.subscription_update.enabled,
          gestcopy_portal: c.metadata?.gestcopy_portal ?? null,
        })),
      };
    }),
    subscriptions: await section(async () => {
      const list = await stripe.subscriptions.list({ status: "all", limit: 100 });
      return { sample: list.data.length, has_more: list.has_more, by_status: countBy(list.data, (s) => s.status) };
    }),
    checkout_sessions: await section(async () => {
      const list = await stripe.checkout.sessions.list({ limit: 100, created: { gte: since } });
      return { since: sinceIso, sample: list.data.length, has_more: list.has_more, by_status: countBy(list.data, (s) => s.status ?? "unknown") };
    }),
    charges: await section(async () => {
      const list = await stripe.charges.list({ limit: 100, created: { gte: since } });
      return {
        since: sinceIso,
        sample: list.data.length,
        has_more: list.has_more,
        by_status: countBy(list.data, (c) => `${c.status}${c.refunded ? "+refunded" : ""}`),
      };
    }),
  };

  console.log(JSON.stringify(report, null, 2));
  const failed = Object.entries(report)
    .filter(([, v]) => typeof v === "object" && v !== null && (v as Section).ok === false)
    .map(([k]) => k);
  if (failed.length > 0) {
    console.error(`Not verified (permissions or errors): ${failed.join(", ")}`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
