import { NextResponse } from "next/server";

/**
 * Real HTTP 400 for requests whose host is not trusted. Intentionally static:
 * never reflects any request header or the rejection reason to the client.
 */
export function untrustedHostResponse() {
  return new NextResponse("Bad Request", {
    status: 400,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      "x-robots-tag": "noindex",
    },
  });
}
