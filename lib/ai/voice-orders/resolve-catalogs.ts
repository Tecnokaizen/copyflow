import type { ExtractionCatalogAlias } from "@/lib/ai/providers/types";
import type { CatalogRef, DraftField } from "@/lib/ai/voice-orders/contract";
import { missingField, proposedField } from "@/lib/ai/voice-orders/contract";

export type CatalogMaps = {
  services: Map<string, CatalogRef>;
  stores: Map<string, CatalogRef>;
  channels: Map<string, CatalogRef>;
  contexts: Map<string, CatalogRef>;
  assignees: Map<string, CatalogRef>;
  aliases: {
    services: ExtractionCatalogAlias[];
    stores: ExtractionCatalogAlias[];
    channels: ExtractionCatalogAlias[];
    contexts: ExtractionCatalogAlias[];
    assignees: ExtractionCatalogAlias[];
  };
};

export function buildCatalogMaps(input: {
  services: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  entry_channels: { id: string; name: string }[];
  order_contexts: { id: string; name: string }[];
  team_members: { id: string; name: string }[];
}): CatalogMaps {
  const alias = <T extends { id: string; name: string }>(
    rows: T[],
    prefix: string
  ) => {
    const map = new Map<string, CatalogRef>();
    const aliases: ExtractionCatalogAlias[] = [];
    rows.forEach((row, index) => {
      const ref = `${prefix}${index + 1}`;
      const value = { id: row.id, label: row.name };
      map.set(ref, value);
      aliases.push({ ref, label: row.name });
    });
    return { map, aliases };
  };

  const services = alias(input.services, "S");
  const stores = alias(input.stores, "T");
  const channels = alias(input.entry_channels, "C");
  const contexts = alias(input.order_contexts, "K");
  const assignees = alias(input.team_members, "X");

  return {
    services: services.map,
    stores: stores.map,
    channels: channels.map,
    contexts: contexts.map,
    assignees: assignees.map,
    aliases: {
      services: services.aliases,
      stores: stores.aliases,
      channels: channels.aliases,
      contexts: contexts.aliases,
      assignees: assignees.aliases,
    },
  };
}

export function resolveCatalogRef(
  ref: string | null | undefined,
  map: Map<string, CatalogRef>,
  heard: string | null = null
): DraftField<CatalogRef> {
  if (!ref) return missingField();
  const value = map.get(ref);
  if (!value) {
    return {
      status: "rejected",
      heard: heard ?? ref,
      reason: "not_in_catalog",
    };
  }
  return proposedField(value, "high", heard);
}
