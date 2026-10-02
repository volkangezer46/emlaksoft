import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatTurkishPhone, isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";
import { notifyTenant } from "@/lib/notify";
import {
  decideNetgsmEventClaim,
  NETGSM_EVENT_CLAIM_LEASE_MS,
  type NetgsmInboundMessage,
} from "@/lib/webhooks/netgsm-contract";

type WebhookStatus = "received" | "processing" | "processed" | "ignored" | "unmatched" | "failed" | "quarantined";

export type NetgsmIngestResult = {
  ok: boolean;
  duplicate?: boolean;
  quarantined?: boolean;
  reason?: string;
  id?: string;
};

async function markEvent(
  eventId: string,
  patch: {
    status: WebhookStatus;
    tenant_id?: string | null;
    error_message?: string | null;
    processed_at?: string | null;
    quarantined_at?: string | null;
  },
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").update(patch).eq("id", eventId);
  if (error) {
    console.error("[netgsm-webhook] event update failed", { code: error.code, status: patch.status });
    return false;
  }
  return true;
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  if (error instanceof Error) return error.name.slice(0, 64) || "Error";
  return "unknown_error";
}

type EventClaim = { id: string; outcome: "claimed" | "duplicate" | "busy" };

async function claimEvent(input: {
  providerEventId: string;
  receiver: string | null;
  payload: Record<string, unknown>;
}): Promise<EventClaim | null> {
  const admin = createAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "netgsm",
      provider_event_id: input.providerEventId,
      routing_key: input.receiver,
      status: "received",
      payload: input.payload,
    })
    .select("id")
    .single();

  let id = inserted?.id as string | undefined;
  let nextAttemptCount = 1;
  let currentStatus: string = "received";
  const now = new Date();
  const staleBefore = new Date(now.getTime() - NETGSM_EVENT_CLAIM_LEASE_MS).toISOString();
  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[netgsm-webhook] inbox insert failed", { code: insertError.code });
      return null;
    }
    const { data: existing, error: readError } = await admin
      .from("webhook_events")
      .select("id, status, attempt_count, last_attempt_at")
      .eq("provider", "netgsm")
      .eq("provider_event_id", input.providerEventId)
      .maybeSingle();
    if (readError) {
      console.error("[netgsm-webhook] inbox read failed", { code: readError.code });
      return null;
    }
    if (!existing) return null;
    const decision = decideNetgsmEventClaim(existing.status, existing.last_attempt_at, now.getTime());
    if (decision === "duplicate") return { id: existing.id, outcome: "duplicate" };
    if (decision === "busy") return { id: existing.id, outcome: "busy" };
    if (decision === "invalid") return null;
    id = existing.id;
    currentStatus = existing.status;
    nextAttemptCount = Number(existing.attempt_count ?? 0) + 1;
  }

  if (!id) return null;
  let claimQuery = admin
    .from("webhook_events")
    .update({
      status: "processing",
      attempt_count: nextAttemptCount,
      last_attempt_at: now.toISOString(),
      error_message: null,
    })
    .eq("id", id);
  claimQuery = currentStatus === "processing"
    ? claimQuery.eq("status", "processing").lt("last_attempt_at", staleBefore)
    : claimQuery.in("status", ["received", "failed"]);
  const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();

  if (claimError) {
    console.error("[netgsm-webhook] inbox claim failed", { code: claimError.code });
    return null;
  }
  if (!claimed) return { id, outcome: "busy" };
  return { id, outcome: "claimed" };
}

export async function quarantineNetgsmEvent(input: {
  providerEventId: string;
  receiver?: string | null;
  payload: Record<string, unknown>;
  reason: string;
}): Promise<NetgsmIngestResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("webhook_events").upsert(
    {
      provider: "netgsm",
      provider_event_id: input.providerEventId,
      routing_key: input.receiver ?? null,
      tenant_id: null,
      status: "quarantined",
      payload: input.payload,
      error_message: input.reason.slice(0, 500),
      quarantined_at: now,
      processed_at: now,
    },
    { onConflict: "provider,provider_event_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[netgsm-webhook] quarantine write failed", { code: error.code });
    return { ok: false, reason: "quarantine_write_failed" };
  }
  return { ok: true, quarantined: true, reason: input.reason };
}

export async function ingestNetgsmInbound(
  message: NetgsmInboundMessage,
  eventPayload: Record<string, unknown>,
): Promise<NetgsmIngestResult> {
  const claimed = await claimEvent({
    providerEventId: message.providerEventId,
    receiver: message.receiver,
    payload: eventPayload,
  });
  if (!claimed) return { ok: false, reason: "event_claim_failed" };
  if (claimed.outcome === "duplicate") return { ok: true, duplicate: true, reason: "duplicate" };
  if (claimed.outcome === "busy") return { ok: false, reason: "event_in_progress" };

  const admin = createAdminClient();
  try {
    // Never infer a tenant from a customer's phone. The provider-owned receiver
    // must map to exactly one active Netgsm integration.
    const { data: integrations, error: integrationError } = await admin
      .from("tenant_integrations")
      .select("id, tenant_id")
      .eq("provider", "netgsm")
      .eq("external_account_id", message.receiver)
      .eq("is_active", true)
      .limit(2);
    if (integrationError) throw integrationError;

    if ((integrations ?? []).length !== 1) {
      const reason = (integrations ?? []).length > 1
        ? "ambiguous_external_account"
        : "unmatched_external_account";
      const now = new Date().toISOString();
      const marked = await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: null,
        error_message: reason,
        quarantined_at: now,
        processed_at: now,
      });
      if (!marked) return { ok: false, reason: "event_update_failed" };
      return { ok: true, quarantined: true, reason };
    }

    const tenantId = String(integrations![0].tenant_id);
    const phone = normalizeTurkishPhone(message.sourceNumber);
    if (!isValidTurkishMobile(phone)) {
      const marked = await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: tenantId,
        error_message: "invalid_source_number",
        quarantined_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
      if (!marked) return { ok: false, reason: "event_update_failed" };
      return { ok: true, quarantined: true, reason: "invalid_source_number" };
    }

    const { data: customers, error: customerError } = await admin
      .from("customers")
      .select("id, full_name, assigned_to, created_at")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(2);
    if (customerError) throw customerError;
    const customer = (customers ?? [])[0] ?? null;

    const { data: communication, error: communicationError } = await admin
      .from("communications")
      .insert({
        tenant_id: tenantId,
        customer_id: customer?.id ?? null,
        created_by: null,
        channel: "sms",
        direction: "inbound",
        subject: "Gelen SMS",
        body: message.message,
        provider: "netgsm",
        provider_message_id: message.providerEventId,
        delivery_status: "received",
        contact_address: phone,
        provider_metadata: {
          receiver: message.receiver,
          sent_at: message.sentAt,
          customer_match_count: (customers ?? []).length,
        },
      })
      .select("id")
      .single();

    if (communicationError) {
      // The communication uniqueness constraint is a second idempotency wall.
      if (communicationError.code !== "23505") throw communicationError;
      const marked = await markEvent(claimed.id, {
        status: "processed",
        tenant_id: tenantId,
        error_message: null,
        processed_at: new Date().toISOString(),
      });
      if (!marked) return { ok: false, reason: "event_update_failed" };
      return { ok: true, duplicate: true, reason: "communication_duplicate" };
    }

    await notifyTenant({
      tenantId,
      userId: (customer?.assigned_to as string | null | undefined) ?? null,
      title: customer?.full_name
        ? `Yeni SMS: ${customer.full_name}`
        : `Yeni SMS: ${formatTurkishPhone(phone)}`,
      body: message.message.slice(0, 120),
      href: customer?.id ? `/app/musteriler/${customer.id}` : "/app/gelen-kutusu",
      kind: "info",
    });

    const marked = await markEvent(claimed.id, {
      status: "processed",
      tenant_id: tenantId,
      error_message: null,
      processed_at: new Date().toISOString(),
    });
    if (!marked) return { ok: false, reason: "event_update_failed" };
    return { ok: true, id: communication.id };
  } catch (error) {
    const code = safeErrorCode(error);
    await markEvent(claimed.id, {
      status: "failed",
      error_message: code,
    });
    console.error("[netgsm-webhook] processing failed", { code });
    return { ok: false, reason: "processing_failed" };
  }
}
