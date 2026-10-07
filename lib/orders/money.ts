const MONEY = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;

export function canonicalMoney(value: string, allowZero: boolean): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!MONEY.test(normalized)) {
    return null;
  }
  const [whole, fraction = ""] = normalized.split(".");
  const canonical = `${whole}.${fraction.padEnd(2, "0")}`;
  if (!allowZero && /^0\.00$/.test(canonical)) {
    return null;
  }
  return canonical;
}

export function formatOrderMoney(value: string | null | undefined): string {
  if (!value || !/^\d+\.\d{2}$/.test(value)) {
    return "—";
  }
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${fraction} €`;
}

export function collectionLabel(state: string | null | undefined): string {
  switch (state) {
    case "unpaid":
      return "Sin cobrar";
    case "partial":
      return "Parcial";
    case "paid":
      return "Cobrado";
    default:
      return "Importe sin definir";
  }
}
