import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatTurkishPhone, isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";
import { notifyTenant } from "@/lib/notify";

type WebhookStatus = "received" | "processing" | "processed" | "ignored" | "unmatched" | "failed" | "quarantined";

export type MetaInboundMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
};

export type MetaIngestResult = {
  ok: boolean;
  duplicate?: boolean;
  quarantined?: boolean;
  reason?: string;
  id?: string;
};

function messageBody(message: MetaInboundMessage): string {
  if (message.type === "text") return message.text?.body?.trim() || "(boş metin)";
  return `[${message.type} mesajı]`;
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
) {
  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").update(patch).eq("id", eventId);
  if (error) console.error("[meta-webhook] event update failed", { code: error.code, status: patch.status });
}

async function claimEvent(input: {
  providerEventId: string;
  routingKey: string | null;
  payload: Record<string, unknown>;
}): Promise<{ id: string; duplicate: boolean } | null> {
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
  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[meta-webhook] inbox insert failed", { code: insertError.code });
      return null;
    }
    const { data: existing, error: readError } = await admin
      .from("webhook_events")
      .select("id, status, attempt_count")
      .eq("provider", "meta")
      .eq("provider_event_id", input.providerEventId)
      .maybeSingle();
    if (readError || !existing) return null;
    if (["processing", "processed", "ignored", "unmatched", "quarantined"].includes(existing.status)) {
      return { id: existing.id, duplicate: true };
    }
    id = existing.id;
    nextAttemptCount = Number(existing.attempt_count ?? 0) + 1;
  }

  if (!id) return null;
  const { data: claimed, error: claimError } = await admin
    .from("webhook_events")
    .update({
      status: "processing",
      attempt_count: nextAttemptCount,
      last_attempt_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", id)
    .in("status", ["received", "failed"])
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[meta-webhook] inbox claim failed", { code: claimError.code });
    return null;
  }
  if (!claimed) return { id, duplicate: true };
  return { id, duplicate: false };
}

/**
 * WhatsApp'tan gelen tek bir mesajı işler (Netgsm SMS inbound deseniyle aynı
 * iskelet, bkz. `netgsm-inbound.ts`): önce `webhook_events`'te idempotency
 * kilidi alınır, tenant SADECE Meta'nın phone_number_id'sinden (müşteri
 * numarasından ASLA) çözülür, sonra `communications`'a yazılır.
 *
 * Giden WhatsApp gönderimi henüz yok (WABA hesabı bağlanmadı) — bu yüzden
 * delivery/read status webhook'ları (`value.statuses[]`) kasıtlı olarak
 * ele alınmıyor; bunları güncelleyecek bir giden mesaj kaydı zaten oluşmuyor.
 */
export async function ingestMetaInboundMessage(
  message: MetaInboundMessage,
  phoneNumberId: string | null,
  rawEntry: Record<string, unknown>,
): Promise<MetaIngestResult> {
  const claimed = await claimEvent({
    providerEventId: message.id,
    routingKey: phoneNumberId,
    payload: rawEntry,
  });
  if (!claimed) return { ok: false, reason: "event_claim_failed" };
  if (claimed.duplicate) return { ok: true, duplicate: true, reason: "duplicate" };

  const admin = createAdminClient();
  try {
    if (!phoneNumberId) {
      const now = new Date().toISOString();
      await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: null,
        error_message: "missing_phone_number_id",
        quarantined_at: now,
        processed_at: now,
      });
      return { ok: true, quarantined: true, reason: "missing_phone_number_id" };
    }

    // Tenant ASLA müşteri numarasından çıkarılmaz — yalnız Meta'nın
    // sağlayıcı-sahipli phone_number_id'si tenant_integrations'a eşlenir
    // (Netgsm'deki subscriberNumber -> external_account_id deseniyle aynı).
    const { data: integrations, error: integrationError } = await admin
      .from("tenant_integrations")
      .select("id, tenant_id")
      .eq("provider", "whatsapp")
      .eq("external_account_id", phoneNumberId)
      .eq("is_active", true)
      .limit(2);
    if (integrationError) throw integrationError;

    if ((integrations ?? []).length !== 1) {
      const reason = (integrations ?? []).length > 1
        ? "ambiguous_external_account"
        : "unmatched_external_account";
      const now = new Date().toISOString();
      await markEvent(claimed.id, {
        status: "quarantined",
        tenant_id: null,
        error_message: reason,
        quarantined_at: now,
        processed_at: now,
      });
      return { ok: true, quarantined: true, reason };
    }

    const tenantId = String(integrations![0].tenant_id);
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
      await markEvent(claimed.id, {
        status: "processed",
        tenant_id: tenantId,
        error_message: null,
        processed_at: new Date().toISOString(),
      });
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

    await markEvent(claimed.id, {
      status: "processed",
      tenant_id: tenantId,
      error_message: null,
      processed_at: new Date().toISOString(),
    });
    return { ok: true, id: communication.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await markEvent(claimed.id, {
      status: "failed",
      error_message: detail.slice(0, 500),
    });
    console.error("[meta-webhook] processing failed", detail);
    return { ok: false, reason: "processing_failed" };
  }
}
