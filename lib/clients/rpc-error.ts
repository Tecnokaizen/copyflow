import { NextResponse } from "next/server";
import { parseClientDuplicate } from "@/lib/clients/types";

type RpcLikeError = {
  code?: string;
  message?: string;
  details?: string;
  detail?: string;
} | null;

export function statusForClientRpcError(code: string | undefined) {
  switch (code) {
    case "28000":
      return 401;
    case "42501":
      return 403;
    case "22023":
      return 400;
    case "P0002":
      return 404;
    case "23505":
      return 409;
    default:
      return 500;
  }
}

export function clientDuplicateResponse(error: RpcLikeError) {
  const message = error?.message ?? "";

  if (error?.code !== "23505" || !message.includes("client_duplicate")) {
    return null;
  }

  const duplicate = parseClientDuplicate(error.details ?? error.detail ?? null);

  return NextResponse.json(
    {
      error: "Client already exists",
      code: "client_duplicate",
      duplicate,
    },
    { status: 409 }
  );
}
