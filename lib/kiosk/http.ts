import { parseKioskOrderPayload, type KioskOrderInput } from "./payload";
import { KioskServiceError } from "./service";
import type { TrustedKioskContext } from "./trusted-request";

type SubmitKioskOrder = (
  context: TrustedKioskContext,
  input: KioskOrderInput
) => Promise<{ ok: true; reference: string; replay: boolean }>;
type AdmitKioskRequest = (
  context: TrustedKioskContext
) => Promise<string>;

const MAX_KIOSK_BODY_BYTES = 16 * 1024;

async function readKioskBody(request: Request) {
  if (!request.body) {
    return { ok: true as const, raw: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      raw += decoder.decode();
      return { ok: true as const, raw };
    }
    bytes += value.byteLength;
    if (bytes > MAX_KIOSK_BODY_BYTES) {
      await reader.cancel();
      return { ok: false as const };
    }
    raw += decoder.decode(value, { stream: true });
  }
}

function kioskJson(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

export async function admitKioskHttpRequest(
  request: Request,
  context: TrustedKioskContext | null,
  admit: AdmitKioskRequest
): Promise<
  | { ok: true; permit: string }
  | { ok: false; response: Response }
> {
  if (!context) {
    return {
      ok: false,
      response: kioskJson({ error: "Kiosk no disponible" }, 404),
    };
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: kioskJson(
        { error: "Content-Type debe ser application/json" },
        415
      ),
    };
  }

  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== expectedOrigin || fetchSite !== "same-origin") {
    return {
      ok: false,
      response: kioskJson({ error: "Solicitud cross-site rechazada" }, 403),
    };
  }

  try {
    return { ok: true, permit: await admit(context) };
  } catch (error) {
    if (
      error instanceof KioskServiceError &&
      error.code === "not_found"
    ) {
      return {
        ok: false,
        response: kioskJson({ error: "Kiosk no disponible" }, 404),
      };
    }
    if (
      error instanceof KioskServiceError &&
      error.code === "rate_limited"
    ) {
      return {
        ok: false,
        response: kioskJson(
          { error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." },
          429
        ),
      };
    }
    return {
      ok: false,
      response: kioskJson({ error: "Kiosk no disponible" }, 503),
    };
  }
}

export async function handleKioskOrderRequest(
  request: Request,
  context: TrustedKioskContext | null,
  submit: SubmitKioskOrder
) {
  if (!context) {
    return kioskJson({ error: "Kiosk no disponible" }, 404);
  }

  let body: unknown;
  try {
    const bodyResult = await readKioskBody(request);
    if (!bodyResult.ok) {
      return kioskJson({ error: "Solicitud demasiado grande" }, 413);
    }
    body = JSON.parse(bodyResult.raw) as unknown;
  } catch {
    return kioskJson({ error: "Solicitud no válida" }, 400);
  }

  const parsed = parseKioskOrderPayload(body);
  if (!parsed.ok) {
    return kioskJson({ error: parsed.error }, 400);
  }

  try {
    const result = await submit(context, parsed.data);
    return kioskJson(
      { ok: true, reference: result.reference },
      result.replay ? 200 : 201
    );
  } catch (error) {
    if (error instanceof KioskServiceError) {
      if (error.code === "not_found") {
        return kioskJson({ error: "Kiosk no disponible" }, 404);
      }
      if (error.code === "invalid_configuration" && error.status === 400) {
        return kioskJson(
          { error: "El servicio seleccionado no está disponible" },
          400
        );
      }
      if (error.code === "invalid_configuration") {
        return kioskJson(
          { error: "Kiosk no disponible temporalmente" },
          503
        );
      }
      if (error.code === "rate_limited") {
        return kioskJson(
          { error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." },
          429
        );
      }
      if (error.code === "could_not_create") {
        return kioskJson({ error: "No se pudo crear la solicitud" }, 409);
      }
    }

    return kioskJson({ error: "No se pudo crear la solicitud" }, 500);
  }
}
