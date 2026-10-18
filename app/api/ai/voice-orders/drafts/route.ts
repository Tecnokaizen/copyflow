import { operationalJson } from "@/lib/http/operational-cache";
import {
  AI_VOICE_MESSAGES,
  assertSameOrigin,
  requireVoiceOrdersAccess,
} from "@/lib/ai/access";
import { loadAiVoiceStatus, reserveAiUsage, settleAiUsage } from "@/lib/ai/budget";
import {
  AI_PRICING_VERSION,
  estimateExtractionReserveMicros,
  extractionActualMicros,
} from "@/lib/ai/pricing";
import { getExtractionProvider } from "@/lib/ai/providers/registry";
import {
  VOICE_ORDER_DRAFT_VERSION,
  missingField,
  proposedField,
  type VoiceOrderDraft,
} from "@/lib/ai/voice-orders/contract";
import { buildCatalogMaps, resolveCatalogRef } from "@/lib/ai/voice-orders/resolve-catalogs";
import { resolveVoiceClient } from "@/lib/ai/voice-orders/resolve-client";
import { resolveVoiceDue } from "@/lib/ai/voice-orders/resolve-due";
import { loadOrderOptions } from "@/lib/orders/options-load";
import { QUICK_ORDER_FIELDS, type QuickOrderField } from "@/lib/settings/quick-order-layout";

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSCRIPT_MAX = 4_000;
const TITLE_MAX = 80;

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidOrigin, code: "invalid_origin" },
      { status: 403 }
    );
  }

  const access = await requireVoiceOrdersAccess(
    "POST /api/ai/voice-orders/drafts"
  );
  if (!access.ok) {
    return access.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidTranscript, code: "invalid_body" },
      { status: 422 }
    );
  }

  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const requestId = typeof row.request_id === "string" ? row.request_id : "";
  const transcript = typeof row.transcript === "string" ? row.transcript.trim() : "";
  const source = row.source === "typed" || row.source === "audio" ? row.source : null;
  const mode = row.mode === "quick" || row.mode === "full" ? row.mode : "full";

  if (!UUID_RE.test(requestId) || !source || !transcript) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidTranscript, code: "invalid_body" },
      { status: 422 }
    );
  }

  if (transcript.length > TRANSCRIPT_MAX) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.invalidTranscript, code: "transcript_too_long" },
      { status: 422 }
    );
  }

  const status = await loadAiVoiceStatus(
    access.supabase,
    access.context.tenant.id
  );
  if (!status?.budget_enabled) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.budgetExhausted, code: "ai_budget_exhausted" },
      { status: 429 }
    );
  }

  const options = await loadOrderOptions(access.supabase, {
    tenantId: access.context.tenant.id,
    tenantSlug: access.context.tenant.slug,
    userId: access.context.user.id,
    actorRole: access.context.membership.role,
  });

  if (!options.ok) {
    return operationalJson(
      { error: AI_VOICE_MESSAGES.unavailable, code: "ai_unavailable" },
      { status: 503 }
    );
  }

  const catalogs = buildCatalogMaps(options.data);
  const provider = getExtractionProvider();
  const estimated = estimateExtractionReserveMicros();
  const reserved = await reserveAiUsage(access.supabase, {
    tenantId: access.context.tenant.id,
    operation: "extraction",
    requestId,
    estimatedMicros: estimated,
    provider: provider.name,
    model: provider.model,
    pricingVersion: AI_PRICING_VERSION,
  });

  if (!reserved.ok) {
    return reserved.response;
  }

  let settleStatus: "committed" | "released" = "released";
  let actualMicros: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let errorCode: string | null = null;
  let providerReached = false;

  try {
    const controller = AbortSignal.timeout(15_000);
    providerReached = true;
    const result = await provider.extract({
      transcript,
      catalog: catalogs.aliases,
      locale: options.data.locale,
      timezone: options.data.timezone,
      nowIso: new Date().toISOString(),
      signal: controller,
    });

    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    actualMicros = extractionActualMicros(inputTokens ?? 0, outputTokens ?? 0);
    settleStatus = "committed";

    const due = resolveVoiceDue(
      result.extraction.due,
      new Date(),
      options.data.timezone
    );
    const client = await resolveVoiceClient(
      access.supabase,
      access.context.tenant.id,
      result.extraction.client
    );

    const titleValue = result.extraction.title
      ? result.extraction.title.slice(0, TITLE_MAX)
      : null;

    const visibleFields = Array.isArray(row.visible_fields)
      ? row.visible_fields.filter(
          (field): field is QuickOrderField =>
            typeof field === "string" &&
            (QUICK_ORDER_FIELDS as readonly string[]).includes(field)
        )
      : [...QUICK_ORDER_FIELDS];

    const draft: VoiceOrderDraft = {
      version: VOICE_ORDER_DRAFT_VERSION,
      draft_id: requestId,
      tenant_slug: access.context.tenant.slug,
      generated_at: new Date().toISOString(),
      transcript: {
        text: transcript,
        source,
        language: options.data.locale,
        truncated: false,
      },
      fields: {
        title: titleValue
          ? proposedField(titleValue, "medium", titleValue)
          : missingField(),
        description: result.extraction.description
          ? proposedField(result.extraction.description, "medium")
          : missingField(),
        notes: result.extraction.notes
          ? proposedField(result.extraction.notes, "low")
          : missingField(),
        client: client.field,
        client_mention: client.mention,
        service: resolveCatalogRef(result.extraction.service_ref, catalogs.services),
        store: resolveCatalogRef(result.extraction.store_ref, catalogs.stores),
        entry_channel: resolveCatalogRef(
          result.extraction.channel_ref,
          catalogs.channels
        ),
        order_context: resolveCatalogRef(
          result.extraction.context_ref,
          catalogs.contexts
        ),
        assigned_team_member: resolveCatalogRef(
          result.extraction.assignee_ref,
          catalogs.assignees
        ),
        priority: result.extraction.priority
          ? proposedField(result.extraction.priority, "medium")
          : missingField(),
        due: due.field,
      },
      warnings: [
        ...due.warnings,
        ...client.warnings,
        ...(mode === "quick"
          ? visibleFields.length === 0
            ? []
            : []
          : []),
      ],
    };

    console.info(
      JSON.stringify({
        scope: "ai_voice_orders",
        operation: "extraction",
        tenant_id: access.context.tenant.id,
        request_id: requestId,
        provider: result.provider,
        model: result.model,
        status: "committed",
        micros: actualMicros,
      })
    );

    return operationalJson(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider_failed";
    const timedOut = message.includes("TimeoutError") || message.includes("abort");
    errorCode = timedOut ? "provider_timeout" : "provider_failed";
    settleStatus = providerReached ? "committed" : "released";
    actualMicros = providerReached ? estimated : 0;

    return operationalJson(
      {
        error: timedOut
          ? AI_VOICE_MESSAGES.providerTimeout
          : AI_VOICE_MESSAGES.providerFailed,
        code: errorCode,
      },
      { status: timedOut ? 504 : 502 }
    );
  } finally {
    await settleAiUsage(access.supabase, {
      eventId: reserved.eventId,
      status: settleStatus,
      actualMicros,
      inputTokens,
      outputTokens,
      errorCode,
    });
  }
}
