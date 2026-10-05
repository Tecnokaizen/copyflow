import { NextRequest } from "next/server";
import { transitionQuote } from "@/lib/quotes/transitions";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return transitionQuote(request, context, "reject");
}
