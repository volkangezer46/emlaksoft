import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { formatPhoneDisplay } from "@/lib/phone";
import { now } from "@/lib/clock";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { INBOUND_ACK_DEFAULT_AFTER, INBOUND_ACK_DEFAULT_HOURS, INBOUND_KEYS } from "@/lib/settings/registry/tenant";
import { createRoutedLeadCustomer } from "@/lib/lead-intake";
import { withinBusinessHours } from "@/lib/lead-routing/logic";
import { sendTenantWhatsAppSessionText } from "@/lib/messaging/tenant-providers";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { stopSequencesOnReply } from "@/lib/automation/sequences";
import { ackDecision, inboundLeadName, inboundSourceFor, type InboundChannel } from "@/lib/automation/inbound-rules";

/**
 * Gelen WhatsApp/SMS'in İLK TEMAS akışı (COM-02 + COM-14 + COM-05). Webhook işleyicisi iletişim satırını yazdıktan
 * SONRA çağırır; ASLA fırlatmaz (webhook sonucu bu adımdan etkilenmez).
 *
 *  1. Bilinmeyen numara + ofis ayarı açık → müşteri kaydı (lead-intake'in TEK oluşturucusu: dağıtım motoru, mesai
 *     ertelemesi). Spam freni: aynı numaradan son 24 saatte açılmış (silinmiş dahil) kayıt varsa yeni kayıt açılmaz.
 *  2. WhatsApp + ayar açık + bilinmeyen numara → ofisin KENDİ hesabından serbest metin karşılama (müşteri az önce
 *     yazdığı için 24 saat penceresi açık). Aynı numaraya 24 saatte en çok bir karşılama.
 *  3. Kayıtlı müşteri yanıt verdi → "yanıt gelince dur" kuralı açık takip dizileri durur.
 *  4. "Gelen mesaj" otomasyon tetikleyicisi (yalnız GELEN mesaj; otomasyonun gönderdiği mesaj tetikleyici olmaz).
 */

export type InboundIntakeInput = {
  tenantId: string;
  channel: InboundChannel;
  /** Sağlayıcının verdiği ham numara (WhatsApp: ülke kodlu rakamlar; Netgsm: 05… / 90…). */
  rawFrom: string;
  body: string;
  communicationId: string;
  customer: { id: string; full_name: string | null; assigned_to: string | null } | null;
};

export type InboundIntakeResult = {
  customerId: string | null;
  customerName: string | null;
  assignedTo: string | null;
  created: boolean;
  acknowledged: boolean;
};

const DAY_MS = 86_400_000;

async function recentlyCreatedForPhone(admin: SupabaseClient, tenantId: string, phone: string): Promise<boolean> {
  const { data, error } = await admin
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .gte("created_at", new Date(now() - DAY_MS).toISOString())
    .limit(1);
  // Okunamazsa kayıt açılmaz (mükerrer kayıt riskine girilmez).
  if (error) return true;
  return (data ?? []).length > 0;
}

async function lastAckAt(admin: SupabaseClient, tenantId: string, address: string): Promise<string | null> {
  const { data, error } = await admin
    .from("communications")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("channel", "whatsapp")
    .eq("direction", "outbound")
    .eq("contact_address", address)
    .eq("subject", "Otomatik karşılama")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return new Date(now()).toISOString(); // okunamazsa gönderme
  return (data?.created_at as string | undefined) ?? null;
}

export async function handleInboundFirstContact(
  admin: SupabaseClient,
  input: InboundIntakeInput,
): Promise<InboundIntakeResult> {
  const out: InboundIntakeResult = {
    customerId: input.customer?.id ?? null,
    customerName: input.customer?.full_name ?? null,
    assignedTo: input.customer?.assigned_to ?? null,
    created: false,
    acknowledged: false,
  };
  const isNewContact = !input.customer;
  try {
    const settings = await readTenantSettings(admin, input.tenantId, [
      INBOUND_KEYS.autoCreate,
      INBOUND_KEYS.autoAck,
      INBOUND_KEYS.ackHours,
      INBOUND_KEYS.ackAfter,
    ]);
    const nowMs = now();
    const inHours = withinBusinessHours(nowMs);
    const digits = input.rawFrom.replace(/\D/g, "");
    const parsed = parsePhoneStrict(digits.startsWith("0") ? digits : `+${digits}`);

    // 1) Bilinmeyen numara → talep kaydı
    if (!input.customer && settings[INBOUND_KEYS.autoCreate] === true && parsed.ok && parsed.stored) {
      if (!(await recentlyCreatedForPhone(admin, input.tenantId, parsed.stored))) {
        const created = await createRoutedLeadCustomer(admin, input.tenantId, {
          fullName: inboundLeadName(input.channel, formatPhoneDisplay(parsed.stored)),
          phone: parsed.stored,
          source: inboundSourceFor(input.channel),
          channel: input.channel,
          notes: input.body.slice(0, 500),
        });
        if (created.ok) {
          out.customerId = created.customerId;
          out.customerName = inboundLeadName(input.channel, formatPhoneDisplay(parsed.stored));
          out.assignedTo = created.assignedTo;
          out.created = true;
          await admin
            .from("communications")
            .update({ customer_id: created.customerId })
            .eq("id", input.communicationId)
            .eq("tenant_id", input.tenantId)
            .is("customer_id", null);
          await admin.from("audit_logs").insert({
            tenant_id: input.tenantId,
            actor_id: null,
            action: "lead.intake.inbound",
            entity_type: "customer",
            entity_id: created.customerId,
            new_value: { channel: input.channel, source: inboundSourceFor(input.channel), assigned_to: created.assignedTo, ...(created.routing ? { routing: created.routing } : {}) },
          });
          // Yeni aday = yeni müşteri: panelden eklenenle aynı "new_customer" kuralları çalışır.
          await dispatchAutomationEvent(input.tenantId, "new_customer", {
            entityType: "customer",
            entityId: created.customerId,
            customerId: created.customerId,
            label: out.customerName,
            assignedTo: created.assignedTo,
            fields: { source: inboundSourceFor(input.channel), channel: input.channel },
          });
        }
      }
    }

    // 2) WhatsApp otomatik karşılama (yalnız bilinmeyen numara)
    if (input.channel === "whatsapp" && isNewContact && settings[INBOUND_KEYS.autoAck] === true) {
      const address = parsed.ok && parsed.stored ? parsed.stored : digits;
      const decision = ackDecision({
        enabled: true,
        lastAckAt: await lastAckAt(admin, input.tenantId, address),
        nowMs,
        inHours,
        textHours: String(settings[INBOUND_KEYS.ackHours] ?? "") || INBOUND_ACK_DEFAULT_HOURS,
        textAfter: String(settings[INBOUND_KEYS.ackAfter] ?? "") || INBOUND_ACK_DEFAULT_AFTER,
      });
      if (decision.send) {
        const sent = await sendTenantWhatsAppSessionText(input.tenantId, address, decision.text, {
          source: "inbound_auto_ack",
          audience: "contact",
        });
        if (sent.ok) {
          out.acknowledged = true;
          await admin.from("communications").insert({
            tenant_id: input.tenantId,
            customer_id: out.customerId,
            created_by: null,
            channel: "whatsapp",
            direction: "outbound",
            subject: "Otomatik karşılama",
            body: decision.text,
            provider: "meta",
            provider_message_id: sent.messageId,
            delivery_status: "sent",
            contact_address: address,
            provider_metadata: { auto_ack: true, in_hours: inHours },
          });
        }
      }
    }

    // 3) Yanıt gelince dur (kayıtlı müşteri)
    if (input.customer?.id) {
      await stopSequencesOnReply(admin, input.tenantId, input.customer.id);
    }

    // 4) "Gelen mesaj" tetikleyicisi
    await dispatchAutomationEvent(input.tenantId, "inbound_message", {
      entityType: out.customerId ? "customer" : "communication",
      entityId: out.customerId ?? input.communicationId,
      customerId: out.customerId,
      label: out.customerName,
      assignedTo: out.assignedTo,
      fields: {
        channel: input.channel,
        body: input.body.slice(0, 1000),
        is_new_contact: isNewContact ? "evet" : "hayir",
        after_hours: inHours ? "hayir" : "evet",
      },
    });
  } catch (e) {
    console.error("[inbound-intake]", e instanceof Error ? e.name : "error");
  }
  return out;
}
