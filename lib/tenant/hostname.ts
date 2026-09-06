export function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .split(":")[0]
    .replace(/\.$/, "");
}

export function getSubdomainFromHostname(hostname: string) {
  const host = normalizeHostname(hostname);

  // Desarrollo local
  if (host === "localhost" || host === "127.0.0.1") {
    return null;
  }

  // Dominio temporal actual de Copyflow
  if (host === "copyflow.tecnokaizen.link") {
    return null;
  }

  // Dominio temporal de pruebas:
  // sur4.copyflow.tecnokaizen.link → sur4
  if (host.endsWith(".copyflow.tecnokaizen.link")) {
    const slug = host.slice(
      0,
      -".copyflow.tecnokaizen.link".length
    );

    if (!slug || slug === "app" || slug.includes(".")) {
      return null;
    }

    return slug;
  }

  // Arquitectura definitiva:
  // sur4.copyflow.com → sur4
  if (host.endsWith(".copyflow.com")) {
    const slug = host.slice(0, -".copyflow.com".length);

    // app.copyflow.com no representa un tenant
    if (!slug || slug === "app" || slug.includes(".")) {
      return null;
    }

    return slug;
  }

  return null;
}