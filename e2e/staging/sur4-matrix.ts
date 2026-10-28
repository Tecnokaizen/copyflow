/**
 * SUR4 E10 (contract §11): the four synthetic tenants of the feature matrix.
 * Shared by the seed (grants) and the runner (what each tenant must show).
 */
import { ORDER_FEATURE_CODES, type OrderFeatureKey, type OrderFeatures } from "../../lib/orders/order-features";
import type { Sur4TenantSlug } from "./guard";
import { SYNTHETIC_EMAIL } from "./synthetic";

export type Sur4Tenant = {
  slug: Sur4TenantSlug;
  name: string;
  features: OrderFeatures;
  /**
   * Stores the runner adds to the default one. completo has two active
   * stores, so the work sheet prints the store next to the reference (N20).
   */
  extraStores: string[];
  /** A synthetic `viewer` member, to check that reading never grants writing. */
  viewer: boolean;
};

const none: OrderFeatures = { customLabels: false, stickyNotes: false, workSequence: false, workSheetFicha: false };

export const SUR4_MATRIX: readonly Sur4Tenant[] = [
  { slug: "e2e-sur4-base", name: "E2E SUR4 Base", features: none, extraStores: [], viewer: false },
  { slug: "e2e-sur4-postits", name: "E2E SUR4 Solo post-its", features: { ...none, stickyNotes: true }, extraStores: [], viewer: false },
  { slug: "e2e-sur4-secuencia", name: "E2E SUR4 Solo secuencia", features: { ...none, workSequence: true }, extraStores: [], viewer: false },
  {
    slug: "e2e-sur4-completo",
    name: "E2E SUR4 de prueba",
    features: { customLabels: true, stickyNotes: true, workSequence: true, workSheetFicha: true },
    extraStores: ["Tienda Norte (E2E)"],
    viewer: true,
  },
];

/** Team of every tenant: two people who receive orders and one who does not. */
export const SUR4_TEAM = [
  { name: "Raquel E2E", can_receive_orders: true },
  { name: "Jesús E2E", can_receive_orders: true },
  { name: "Davinia E2E", can_receive_orders: false },
] as const;

/** Catalog service of every tenant, for the «service inside/outside the description» orders. */
export const SUR4_SERVICE = "Tarjetas de visita E2E";

export const SUR4_FEATURE_KEYS = Object.keys(ORDER_FEATURE_CODES) as OrderFeatureKey[];

export function ownerEmail(slug: Sur4TenantSlug, role: "owner" | "viewer" = "owner"): string {
  const email = `${slug}-${role}@example.com`;
  if (!SYNTHETIC_EMAIL.test(email)) throw new Error(`not a synthetic address: ${email}`);
  return email;
}
