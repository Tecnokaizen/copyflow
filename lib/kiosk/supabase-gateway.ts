import type { KioskOrderInput } from "./payload";
import type { KioskCapability } from "./trusted-request";

type RpcResult = Promise<{ data: unknown; error: unknown }>;

export type KioskRpcClient = {
  rpc(name: string, args: Record<string, unknown>): RpcResult;
};

export type KioskGateway = {
  bootstrap(capability: KioskCapability): Promise<unknown>;
  submit(
    capability: KioskCapability,
    input: KioskOrderInput,
    fingerprint: string,
    title: string
  ): Promise<unknown>;
};

function capabilityArgs(capability: KioskCapability) {
  return {
    p_tenant_slug: capability.tenantSlug,
    p_client_key: capability.clientKey,
    p_issued_at: capability.issuedAt,
    p_signature: capability.signature,
  };
}

function dataOrThrow(result: { data: unknown; error: unknown }) {
  if (result.error) throw result.error;
  return result.data;
}

export function createSupabaseKioskGateway(
  client: KioskRpcClient
): KioskGateway {
  return {
    async bootstrap(capability) {
      return dataOrThrow(
        await client.rpc("kiosk_bootstrap", capabilityArgs(capability))
      );
    },

    async submit(capability, input, fingerprint, title) {
      return dataOrThrow(
        await client.rpc("submit_kiosk_order", {
          ...capabilityArgs(capability),
          p_submission_id: input.submissionId,
          p_request_fingerprint: fingerprint,
          p_title: title,
          p_service_id: input.serviceId,
          p_contact_name: input.contact.name,
          p_contact_email: input.contact.email,
          p_contact_phone: input.contact.phone,
          p_description: input.description,
          p_due_at: input.dueAt,
          p_observations: input.observations,
        })
      );
    },
  };
}
