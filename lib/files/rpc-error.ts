import { mapLifecycleRpcError } from "@/lib/orders/lifecycle-rpc-error";

export type FilesRpcErrorInput = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null | undefined;

export function mapOrderFileRpcError(
  error: FilesRpcErrorInput,
  fallbackError = "Request failed"
): { status: number; body: Record<string, unknown> } {
  const message = (error?.message ?? "").toLowerCase();

  if (message.includes("upload expired")) {
    return {
      status: 410,
      body: { error: "Upload expired", code: "UPLOAD_EXPIRED" },
    };
  }

  if (message.includes("file not found")) {
    return {
      status: 404,
      body: { error: "File not found" },
    };
  }

  const mapped = mapLifecycleRpcError(error, fallbackError);
  return { status: mapped.status, body: mapped.body };
}
