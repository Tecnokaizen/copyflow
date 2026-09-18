export function parseExpectedVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  return value;
}

export function rpcExpectedVersionArg(token: string): string {
  return token;
}

export function invalidExpectedVersionResponse(value: unknown): {
  status: 422;
  body: { error: string };
} | null {
  if (parseExpectedVersion(value) !== null) {
    return null;
  }

  return {
    status: 422,
    body: { error: "expected_version is required" },
  };
}

export function readReturnedVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const version = (payload as { version?: unknown }).version;
  if (typeof version === "string") {
    return parseExpectedVersion(version);
  }

  if (typeof version === "number" || typeof version === "bigint") {
    return parseExpectedVersion(String(version));
  }

  return null;
}

export function applyReturnedVersion<T extends { version: string }>(
  current: T,
  result: unknown
): T {
  const version = readReturnedVersion(result);
  if (!version) {
    return current;
  }

  return { ...current, version };
}

export function omitRowVersion<T extends Record<string, unknown>>(row: T) {
  const rest: Record<string, unknown> = { ...row };
  delete rest.row_version;
  return rest as Omit<T, "row_version">;
}

export function omitRowVersionFromList(rows: unknown[]) {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }

    return omitRowVersion(row as Record<string, unknown>);
  });
}

export function toPublicOrderDto<T extends Record<string, unknown>>(row: T) {
  const { row_version: rowVersion } = row;
  return {
    ...omitRowVersion(row),
    version: String(rowVersion),
  };
}

export function staleSaveMessage(succeededCount: number): string {
  if (succeededCount <= 0) {
    return "Este pedido ha cambiado desde que empezaste a editarlo.";
  }

  if (succeededCount === 1) {
    return "Este pedido ha cambiado desde que empezaste a editarlo. Se guardó 1 cambio.";
  }

  return `Este pedido ha cambiado desde que empezaste a editarlo. Se guardaron ${succeededCount} cambios.`;
}
