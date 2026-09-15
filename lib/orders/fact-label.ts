export function formatFactLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.endsWith(":") ? trimmed : `${trimmed}:`;
}
