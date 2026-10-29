import "server-only";

import { getObjectBytes } from "@/lib/storage/r2";
import {
  LOGO_MAX_BYTES,
  sniffLogoContentType,
  type StoredLogo,
} from "@/lib/tenant/branding";

/**
 * The tenant logo for the receipt PDF (PNG or JPEG, like the quote PDF). The
 * loader already checked that the key belongs to the session tenant. Missing,
 * WebP or invalid bytes print the business name instead of failing.
 */
export async function loadReceiptLogo(logo: StoredLogo | null): Promise<Buffer | undefined> {
  if (!logo || logo.contentType === "image/webp") return undefined;
  try {
    const asset = await getObjectBytes({ key: logo.storageKey });
    if (!asset || asset.body.length === 0 || asset.body.length > LOGO_MAX_BYTES) return undefined;
    if (sniffLogoContentType(asset.body) !== logo.contentType) return undefined;
    return Buffer.from(asset.body);
  } catch {
    return undefined;
  }
}
