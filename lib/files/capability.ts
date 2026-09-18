import { createHmac } from "node:crypto";

export const FILES_CAPABILITY_TTL_SECONDS = 120;

export type FilesCapabilityPurpose = "create" | "complete" | "delete";

export type FilesCapabilityInput = {
  purpose: FilesCapabilityPurpose;
  userId: string;
  tenantId: string;
  orderId: string;
  fileId: string;
  issuedAt: number;
};

export type FilesCapability = {
  issuedAt: number;
  signature: string;
};

/** Canonical payload: files-v1|{purpose}|{user_id}|{tenant_id}|{order_id}|{file_id}|{issued_at} */
export function buildFilesCapabilityPayload(input: FilesCapabilityInput): string {
  return [
    "files-v1",
    input.purpose,
    input.userId,
    input.tenantId,
    input.orderId,
    input.fileId,
    String(input.issuedAt),
  ].join("|");
}

export function filesCapabilityIssuedAtNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function requireFilesSigningSecret(
  secret: string | null | undefined = process.env.FILES_SIGNING_SECRET
): string {
  const value = typeof secret === "string" ? secret.trim() : "";
  if (value.length < 32) {
    throw new Error("Files signing secret must contain at least 32 characters");
  }
  return value;
}

export function createFilesCapability(
  input: FilesCapabilityInput,
  secret: string
): FilesCapability {
  const signingSecret = requireFilesSigningSecret(secret);
  if (
    !Number.isInteger(input.issuedAt) ||
    input.issuedAt < 0 ||
    !Number.isSafeInteger(input.issuedAt)
  ) {
    throw new Error("Files capability issuedAt is invalid");
  }
  const signature = createHmac("sha256", signingSecret)
    .update(buildFilesCapabilityPayload(input), "utf8")
    .digest("hex");
  return {
    issuedAt: input.issuedAt,
    signature,
  };
}
