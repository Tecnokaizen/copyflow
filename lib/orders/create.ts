const TITLE_MAX_LENGTH = 80;

function firstLine(value: string) {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line;
}

function clipTitle(value: string) {
  if (value.length <= TITLE_MAX_LENGTH) {
    return value;
  }

  return value.slice(0, TITLE_MAX_LENGTH).trimEnd();
}

export function deriveOrderTitle(input: {
  title?: string | null;
  description?: string | null;
  serviceName?: string | null;
}): string {
  const explicit = input.title?.trim();
  if (explicit) {
    return clipTitle(explicit);
  }

  const fromDescription = firstLine(input.description ?? "");
  if (fromDescription) {
    return clipTitle(fromDescription);
  }

  const fromService = input.serviceName?.trim();
  if (fromService) {
    return clipTitle(fromService);
  }

  return "Pedido";
}

const CREATE_ORDER_ERROR_COPY: Record<string, string> = {
  "title is required": "El nombre del pedido es obligatorio",
  "Invalid due_at": "La fecha prevista no es válida",
  "Invalid priority": "La prioridad no es válida",
  "Invalid related record for current tenant":
    "Hay un dato que no pertenece a esta organización",
  "Could not create order": "No se pudo crear el pedido",
  "Could not create client": "No se pudo crear el cliente",
  "Unauthorized or tenant access denied":
    "No tienes permiso para crear este pedido",
  "Tenant has no initial order status configured":
    "Esta organización no tiene un estado inicial de pedido",
};

export function userFacingCreateOrderError(error: string) {
  const trimmed = error.trim();
  return CREATE_ORDER_ERROR_COPY[trimmed] ?? trimmed;
}
