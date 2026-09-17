import { NextResponse } from "next/server";

const UNAVAILABLE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Kiosk no disponible</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 2.5rem 1rem; }
    section { width: 100%; max-width: 32rem; border: 1px solid #e4e4e7; border-radius: 1rem; background: #fff; padding: 1.75rem; text-align: center; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
    h1 { margin: 0; font-size: 1.5rem; }
    p { margin: 0.75rem 0 0; color: #71717a; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Kiosk no disponible</h1>
      <p>Comprueba la dirección o contacta con la copistería.</p>
    </section>
  </main>
</body>
</html>`;

/** Real HTTP 404 before Cache Components streaming starts. */
export function kioskUnavailableResponse() {
  return new NextResponse(UNAVAILABLE_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      "x-robots-tag": "noindex",
    },
  });
}
