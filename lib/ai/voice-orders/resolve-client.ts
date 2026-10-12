import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientCandidate,
  DraftField,
  VoiceDraftWarningCode,
} from "@/lib/ai/voice-orders/contract";
import { missingField } from "@/lib/ai/voice-orders/contract";

type Mention = {
  name: string | null;
  phone: string | null;
  company: string | null;
};

export async function resolveVoiceClient(
  supabase: SupabaseClient,
  tenantId: string,
  mention: Mention | null
): Promise<{
  field: DraftField<ClientCandidate>;
  mention: Mention | null;
  warnings: { code: VoiceDraftWarningCode; field?: string; message: string }[];
}> {
  if (!mention || (!mention.name && !mention.phone && !mention.company)) {
    return { field: missingField(), mention: null, warnings: [] };
  }

  const warnings: {
    code: VoiceDraftWarningCode;
    field?: string;
    message: string;
  }[] = [];

  const queries = [mention.phone, mention.name, mention.company].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  const seen = new Map<string, ClientCandidate>();

  for (const query of queries) {
    const { data, error } = await supabase.rpc("search_clients", {
      p_tenant_id: tenantId,
      p_query: query,
      p_limit: 5,
    });

    if (error || !Array.isArray(data)) {
      continue;
    }

    for (const row of data as Array<{
      id?: string;
      name?: string;
      phone?: string | null;
    }>) {
      if (!row.id || !row.name || seen.has(row.id)) continue;
      const phone = typeof row.phone === "string" ? row.phone : null;
      const exactPhone =
        Boolean(mention.phone) &&
        Boolean(phone) &&
        normalizePhone(phone) === normalizePhone(mention.phone);
      const exactName =
        Boolean(mention.name) &&
        row.name.trim().toLowerCase() === mention.name!.trim().toLowerCase();

      seen.set(row.id, {
        id: row.id,
        label: row.name,
        match: exactPhone ? "exact_phone" : exactName ? "exact_name" : "partial",
        phone_hint: phone ? phone.slice(-4) : null,
      });
    }
  }

  const candidates = [...seen.values()];
  if (candidates.length === 0) {
    warnings.push({
      code: "client_not_found",
      field: "client",
      message: "No hay un cliente coincidente; puedes crearlo o dejarlo vacío.",
    });
    return { field: missingField(), mention, warnings };
  }

  const exact = candidates.filter(
    (item) => item.match === "exact_phone" || item.match === "exact_name"
  );

  if (exact.length === 1) {
    return {
      field: {
        status: "proposed",
        value: exact[0],
        confidence: exact[0].match === "exact_phone" ? "high" : "medium",
        heard: mention.name ?? mention.phone,
      },
      mention,
      warnings,
    };
  }

  if (exact.length > 1 || candidates.length > 1) {
    warnings.push({
      code: "client_homonyms",
      field: "client",
      message: "Hay varios clientes posibles; elige uno.",
    });
    return {
      field: {
        status: "ambiguous",
        candidates: exact.length > 1 ? exact : candidates,
        heard: mention.name ?? mention.phone ?? "cliente",
        reason: "Varias coincidencias",
      },
      mention,
      warnings,
    };
  }

  return {
    field: {
      status: "proposed",
      value: candidates[0],
      confidence: "low",
      heard: mention.name ?? mention.phone,
    },
    mention,
    warnings,
  };
}

function normalizePhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D+/g, "");
}
