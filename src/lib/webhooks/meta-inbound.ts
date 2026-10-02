import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatTurkishPhone, isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";
import { notifyTenant } from "@/lib/notify";
import {
  advanceMetaDeliveryState,
  decideMetaEventClaim,
  META_EVENT_CLAIM_LEASE_MS,
  type MetaDeliveryState,
  type MetaInboundMessage,
  type ParsedMetaDeliveryStatus,
} from "@/lib/webhooks/meta-contract";

type WebhookStatus = "received" | "processing" | "processed" | "ignored" | "unmatched" | "failed" | "quarantined";

export type MetaIngestResult = {
  ok: boolean;
  duplicate?: boolean;
  quarantined?: boolean;
  reason?: string;
  id?: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

type CommunicationDeliveryRow = {
  id: string;
  delivery_status: string | null;
  delivered_at: string | null;
  read_at: string | null;
};

function communicationDeliveryState(row: CommunicationDeliveryRow): MetaDeliveryState {
  if (row.read_at || row.delivery_status === "read") {
    return { status: "read", deliveredAt: row.delivered_at, readAt: row.read_at };
  }
  if (row.delivered_at || row.delivery_status === "delivered") {
    return { status: "delivered", deliveredAt: row.delivered_at, readAt: null };
  }
  if (row.delivery_status === "failed") {
    return { status: "failed", deliveredAt: row.delivered_at, readAt: row.read_at };
  }
  return { status: "sent", deliveredAt: null, readAt: null };
}

async function loadCommunicationDelivery(
  admin: AdminClient,
  communicationId: string,
  tenantId: string,
  providerMessageId: string,
): Promise<CommunicationDeliveryRow | null> {
  const { data, error } = await admin
    .from("communications")
    .select("id, delivery_status, delivered_at, read_at")
    .eq("id", communicationId)
    .eq("tenant_id", tenantId)
    .in("provider", ["meta", "whatsapp"])
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw error;
  return data as CommunicationDeliveryRow | null;
}

async function applyCommunicationDeliveryStatus(
  admin: AdminClient,
  communicationId: string,
  tenantId: string,
  status: ParsedMetaDeliveryStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await loadCommunicationDelivery(
      admin,
      communicationId,
      tenantId,
      status.messageId,
    );
    if (!row) return;
    const next = advanceMetaDeliveryState(
      communicationDeliveryState(row),
      status.status,
      status.occurredAt,
    );
    if (!next) return;

    let query = admin
      .from("communications")
      .update({
        delivery_status: next.status,
        delivered_at: next.deliveredAt,
        read_at: next.readAt,
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId)
      .in("provider", ["meta", "whatsapp"])
      .eq("provider_message_id", status.messageId);
    query = row.delivery_status
      ? query.eq("delivery_status", row.delivery_status)
      : query.is("delivery_status", null);
    query = row.delivered_at
      ? query.eq("delivered_at", row.delivered_at)
      : query.is("delivered_at", null);
    query = row.read_at ? query.eq("read_at", row.read_at) : query.is("read_at", null);
    const { data: updated, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (updated) return;
  }
}

function messageBody(message: MetaInboundMessage): string {
  if (message.type === "text") return message.text?.body?.trim().slice(0, 4096) || "(boş metin)";
  return `[${message.type} mesajı]`;
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  if (error instanceof Error) return error.name.slice(0, 64) || "Error";
  return "unknown_error";
}

async function resolveVerifiedWhatsAppTenant(
  admin: AdminClient,
  phoneNumberId: string,
  wabaId: string,
): Promise<{ tenantId: string } | { reason: string }> {
  const { data, error } = await admin.rpc("resolve_verified_whatsapp_tenant", {
    p_phone_number_id: phoneNumberId,
    p_waba_id: wabaId,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) {
    return {
      reason: rows.length > 1
        ? "ambiguous_verified_binding"
        : "unmatched_verified_binding",
    };
  }
  const row = rows[0] && typeof rows[0] === "object"
    ? rows[0] as Record<string, unknown>
    : null;
  return typeof row?.tenant_id === "string"
    ? { tenantId: row.tenant_id }
    : { reason: "invalid_verified_binding" };
}

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
    console.error("[meta-webhook] event update failed", { code: error.code, status: patch.status });
    return false;
  }
  return true;
}

type EventClaim = { id: string; outcome: "claimed" | "duplicate" | "busy" };

async function claimEvent(input: {
  providerEventId: string;
  routingKey: string | null;
  payload: Record<string, unknown>;
}): Promise<EventClaim | null> {
  const admin = createAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "meta",
      provider_event_id: input.providerEventId,
      routing_key: input.routingKey,
      status: "received",
      payload: input.payload,
    })
    .select("id")
    .single();

  let id = inserted?.id as string | undefined;
  let nextAttemptCount = 1;
  let currentStatus: string = "received";
  const now = new Date();
  const staleBefore = new Date(now.getTime() - META_EVENT_CLAIM_LEASE_MS).toISOString();
  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[meta-webhook] inbox insert failed", { code: insertError.code });
      return null;
    }
    const { data: existing, error: readError } = await admin
      .from("webhook_events")
      .select("id, status, attempt_count, last_attempt_at")
      .eq("provider", "meta")
      .eq("provider_event_id", input.providerEventId)
      .maybeSingle();
    if (readError) {
      console.error("[meta-webhook] inbox read failed", { code: readError.code });
      return null;
    }
    if (!existing) return null;
    const decision = decideMetaEventClaim(existing.status, existing.last_attempt_at, now.getTime());
    if (decision === "duplicate") {
      return { id: existing.id, outcome: "duplicate" };
    }
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
    console.error("[meta-webhook] inbox claim failed", { code: claimError.code });
    return null;
  }
  if (!claimed) return { id, outcome: "busy" };
  return { id, outcome: "claimed" };
}

/**
 * Applies outbound delivery receipts without trusting recipient addresses.
 * The signed metadata.phone_number_id resolves the tenant first; provider
 * message IDs are looked up only inside that tenant boundary.
 */
export async function ingestMetaDeliveryStatus(
  status: ParsedMetaDeliveryStatus,
): Promise<MetaIngestResult> {
  const claimed = await claimEvent({
    providerEventId: `delivery:${status.messageId}:${status.status}:${status.occurredAt}`,
    routingKey: `${status.wabaId}:${status.phoneNumberId}`,
    payload: status.eventPayload,
  });
  if (!claimed) return { ok: false, reason: "event_claim_failed" };
  if (claimed.outcome === "duplicate") {
    return { ok: true, duplicate: true, reason: "duplicate" };
  }
  if (claimed.outcome === "busy") {
    return { ok: false, reason: "event_in_progress" };
  }

  const admin = createAdminClient();
  try {
    const resolved = await resolveVerifiedWhatsAppTenant(
      admin,
      status.phoneNumberId,
      status.wabaId,
    );
    if (!("tenantId" in resolved)) {
      const reason = resolved.reason;
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

    const tenantId = resolved.tenantId;
    const [{ data: recipientResult, error: recipientError }, { data: communicationMatches, error: communicationError }] =
      await Promise.all([
        admin.rpc("apply_campaign_recipient_provider_status", {
          p_tenant_id: tenantId,
          p_provider: "whatsapp",
          p_provider_message_id: status.messageId,
          p_status: status.status,
          p_occurred_at: status.occurredAt,
          p_error_code: status.errorCode,
        }),
        admin
          .from("communications")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("provider", ["meta", "whatsapp"])
          .eq("provider_message_id", status.messageId)
          .limit(2),
      ]);
    if (communicationError) throw communicationError;

    if (recipientError?.code === "21000" || (communicationMatches ?? []).length > 1) {
      const now = new Date().toISOString();
      const marked = await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: tenantId,
        error_message: "ambiguous_provider_message",
        quarantined_at: now,
        processed_at: now,
      });
      if (!marked) return { ok: false, reason: "event_update_failed" };
      return { ok: true, quarantined: true, reason: "ambiguous_provider_message" };
    }
    if (recipientError) throw recipientError;

    await Promise.all(
      (communicationMatches ?? []).map((row) =>
        applyCommunicationDeliveryStatus(admin, String(row.id), tenantId, status),
      ),
    );

    const recipientMatched = Boolean(
      recipientResult &&
      typeof recipientResult === "object" &&
      !Array.isArray(recipientResult) &&
      recipientResult.matched === true,
    );
    const matched = recipientMatched || (communicationMatches ?? []).length > 0;
    const marked = await markEvent(claimed.id, {
      status: matched ? "processed" : "unmatched",
      tenant_id: tenantId,
      error_message: matched ? null : "provider_message_not_found",
      processed_at: new Date().toISOString(),
    });
    if (!marked) return { ok: false, reason: "event_update_failed" };
    return { ok: true, reason: matched ? "delivery_status_applied" : "provider_message_not_found" };
  } catch (error) {
    const code = safeErrorCode(error);
    await markEvent(claimed.id, { status: "failed", error_message: code });
    console.error("[meta-webhook] delivery processing failed", { code });
    return { ok: false, reason: "processing_failed" };
  }
}

/**
 * Processes one inbound WhatsApp message with the same inbox/lease pattern as
 * Netgsm. The tenant is resolved only from Meta's exact WABA + phone_number_id
 * verified binding; a customer address is never allowed to choose the tenant.
 * Outbound status receipts are handled separately above.
 */
export async function ingestMetaInboundMessage(
  message: MetaInboundMessage,
  phoneNumberId: string | null,
  wabaId: string | null,
  eventPayload: Record<string, unknown>,
): Promise<MetaIngestResult> {
  const claimed = await claimEvent({
    providerEventId: message.id,
    routingKey: phoneNumberId && wabaId ? `${wabaId}:${phoneNumberId}` : phoneNumberId,
    payload: eventPayload,
  });
  if (!claimed) return { ok: false, reason: "event_claim_failed" };
  if (claimed.outcome === "duplicate") {
    return { ok: true, duplicate: true, reason: "duplicate" };
  }
  if (claimed.outcome === "busy") {
    return { ok: false, reason: "event_in_progress" };
  }

  const admin = createAdminClient();
  try {
    if (!phoneNumberId || !wabaId) {
      const now = new Date().toISOString();
      const marked = await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: null,
        error_message: !phoneNumberId ? "missing_phone_number_id" : "missing_waba_id",
        quarantined_at: now,
        processed_at: now,
      });
      if (!marked) return { ok: false, reason: "event_update_failed" };
      return {
        ok: true,
        quarantined: true,
        reason: !phoneNumberId ? "missing_phone_number_id" : "missing_waba_id",
      };
    }

    // Tenant ASLA müşteri numarasından çıkarılmaz. İmzalı payload içindeki
    // phone_number_id + WABA ID çifti yalnız sağlıklı ve Meta-doğrulanmış
    // immutable binding RPC'si üzerinden çözülür.
    const resolved = await resolveVerifiedWhatsAppTenant(admin, phoneNumberId, wabaId);
    if (!("tenantId" in resolved)) {
      const reason = resolved.reason;
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

    const tenantId = resolved.tenantId;
    const phone = normalizeTurkishPhone(message.from);
    const validPhone = isValidTurkishMobile(phone);

    const { data: customers, error: customerError } = validPhone
      ? await admin
          .from("customers")
          .select("id, full_name, assigned_to, created_at")
          .eq("tenant_id", tenantId)
          .eq("phone", phone)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(2)
      : { data: [], error: null };
    if (customerError) throw customerError;
    const customer = (customers ?? [])[0] ?? null;

    const { data: communication, error: communicationError } = await admin
      .from("communications")
      .insert({
        tenant_id: tenantId,
        customer_id: customer?.id ?? null,
        created_by: null,
        channel: "whatsapp",
        direction: "inbound",
        subject: "Gelen WhatsApp mesajı",
        body: messageBody(message),
        provider: "meta",
        provider_message_id: message.id,
        delivery_status: "received",
        contact_address: validPhone ? phone : message.from,
        provider_metadata: {
          phone_number_id: phoneNumberId,
          timestamp: message.timestamp ?? null,
          message_type: message.type,
          customer_match_count: (customers ?? []).length,
        },
      })
      .select("id")
      .single();

    if (communicationError) {
      // communications'daki (tenant_id, provider, provider_message_id) unique index
      // ikinci bir idempotency duvarı — Netgsm akışıyla aynı davranış.
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
        ? `Yeni WhatsApp mesajı: ${customer.full_name}`
        : `Yeni WhatsApp mesajı: ${validPhone ? formatTurkishPhone(phone) : message.from}`,
      body: messageBody(message).slice(0, 120),
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
    console.error("[meta-webhook] processing failed", { code });
    return { ok: false, reason: "processing_failed" };
  }
}
