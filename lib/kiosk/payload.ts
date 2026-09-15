const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type KioskContactInput = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type KioskOrderInput = {
  submissionId: string;
  contact: KioskContactInput;
  serviceId: string;
  description: string;
  dueAt: string | null;
  observations: string | null;
};

type ParseResult =
  | { ok: true; data: KioskOrderInput }
  | { ok: false; error: string };

const TOP_LEVEL_KEYS = new Set([
  "submission_id",
  "contact",
  "service_id",
  "description",
  "due_at",
  "observations",
]);
const CONTACT_KEYS = new Set(["name", "email", "phone"]);

function optionalText(
  value: unknown,
  maxLength: number
): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  return trimmed.length <= maxLength
    ? { ok: true, value: trimmed }
    : { ok: false };
}

export function parseKioskOrderPayload(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Solicitud no válida" };
  }

  const payload = input as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !TOP_LEVEL_KEYS.has(key))) {
    return { ok: false, error: "Solicitud no válida" };
  }

  const contactValue = payload.contact;
  if (
    !contactValue ||
    typeof contactValue !== "object" ||
    Array.isArray(contactValue)
  ) {
    return { ok: false, error: "Contacto no válido" };
  }
  const contact = contactValue as Record<string, unknown>;
  if (Object.keys(contact).some((key) => !CONTACT_KEYS.has(key))) {
    return { ok: false, error: "Contacto no válido" };
  }

  const name =
    typeof contact.name === "string" ? contact.name.trim() : "";
  const email = optionalText(contact.email, 254);
  const phone = optionalText(contact.phone, 40);
  const description =
    typeof payload.description === "string"
      ? payload.description.trim()
      : "";
  const observations = optionalText(payload.observations, 2000);

  if (
    !UUID_PATTERN.test(String(payload.submission_id ?? "")) ||
    !UUID_PATTERN.test(String(payload.service_id ?? "")) ||
    !name ||
    name.length > 120 ||
    !email.ok ||
    !phone.ok ||
    (!email.value && !phone.value) ||
    (email.value && !EMAIL_PATTERN.test(email.value)) ||
    !description ||
    description.length > 4000 ||
    !observations.ok
  ) {
    return { ok: false, error: "Solicitud no válida" };
  }

  let dueAt: string | null = null;
  if (payload.due_at != null && payload.due_at !== "") {
    if (typeof payload.due_at !== "string") {
      return { ok: false, error: "Fecha no válida" };
    }
    const parsedDate = new Date(payload.due_at);
    if (Number.isNaN(parsedDate.getTime())) {
      return { ok: false, error: "Fecha no válida" };
    }
    dueAt = parsedDate.toISOString();
  }

  return {
    ok: true,
    data: {
      submissionId: String(payload.submission_id).toLowerCase(),
      contact: {
        name,
        email: email.value?.toLowerCase() ?? null,
        phone: phone.value,
      },
      serviceId: String(payload.service_id).toLowerCase(),
      description,
      dueAt,
      observations: observations.value,
    },
  };
}

export function buildKioskOrderNotes(input: KioskContactInput & {
  observations: string | null;
}) {
  const lines = ["Solicitud Kiosk", `Contacto: ${input.name}`];
  if (input.email) lines.push(`Email: ${input.email}`);
  if (input.phone) lines.push(`Teléfono: ${input.phone}`);
  if (input.observations) {
    lines.push(`Observaciones: ${input.observations}`);
  }
  return lines.join("\n");
}
