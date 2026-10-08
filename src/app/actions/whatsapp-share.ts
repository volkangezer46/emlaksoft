"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { getBaseUrl } from "@/lib/base-url";
import { formatPhoneDisplay } from "@/lib/phone";
import { generateValuationShareLink } from "@/app/actions/valuations";
import { SHARE_PURPOSE, buildShareHref, buildShareMessage, whatsappShareGate, type ConsentStatus, type ShareKind } from "@/lib/whatsapp-share";

export type WhatsAppShareResult = {
  ok?: boolean;
  error?: string;
  /** Token'lı paylaşım bağlantısı. */
  url?: string;
  message?: string;
  /** wa.me bağlantısı (alıcı kayıtlıysa doğrudan ona; değilse alıcı seçtiren paylaşım). */
  waHref?: string | null;
  recipient?: { name: string; phoneDisplay: string } | null;
  /** İYS kapısından gelen bilgi notu (ticari ileti, alıcı belirsiz). */
  note?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Değerleme raporu / portföy sunumu için tek tık WhatsApp paylaşımı hazırlar: token'lı bağlantı (değerlemede idempotent,
 * sunumda mevcut `public_token`) + wa.me. Alıcı: değerlemede portföyün malik müşterisi, sunumda sunumun müşterisi
 * (telefon kayıtlı biçimden, `formatPhoneDisplay` ile gösterilir). Alıcı bilgisini okumak `customers.view` ister; yoksa alıcısız
 * paylaşım (WhatsApp'ta kişi seçilir). Ticari iletide (sunum) alıcı belliyse İYS WhatsApp izni şarttır.
 */
export async function prepareWhatsAppShare(input: { kind: ShareKind; id: string }): Promise<WhatsAppShareResult> {
  const kind = input?.kind;
  const id = String(input?.id ?? "").trim();
  if ((kind !== "valuation" && kind !== "presentation") || !UUID_RE.test(id)) return { error: "Paylaşılacak kayıt bulunamadı." };

  const gate = kind === "valuation" ? await requirePermission("valuation", "edit") : await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  let url = "";
  let title: string | null = null;
  let customerId: string | null = null;

  if (kind === "valuation") {
    const { data: valuation } = await supabase
      .from("valuations")
      .select("id, title, property_id")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!valuation) return { error: "Değerleme bulunamadı." };
    title = (valuation.title as string | null) ?? null;
    if (valuation.property_id) {
      const { data: prop } = await supabase
        .from("properties")
        .select("owner_customer_id")
        .eq("id", valuation.property_id as string)
        .eq("tenant_id", gate.tenantId)
        .maybeSingle();
      customerId = ((prop as { owner_customer_id?: string | null } | null)?.owner_customer_id as string | null | undefined) ?? null;
    }
    const link = await generateValuationShareLink(id);
    if (link.error || !link.url) return { error: link.error ?? actionErrorMessage(null, "Paylaşım bağlantısı oluşturulamadı.") };
    url = link.url;
  } else {
    const { data: pres } = await supabase
      .from("presentations")
      .select("id, title, public_token, customer_id")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!pres) return { error: "Sunum bulunamadı." };
    title = (pres.title as string | null) ?? null;
    customerId = (pres.customer_id as string | null) ?? null;
    url = `${getBaseUrl()}/sunum/${pres.public_token as string}`;
  }

  // Alıcı: yalnız müşteri görüntüleme yetkisi varsa okunur (telefon kişisel veridir).
  let recipient: { name: string; phoneDisplay: string; stored: string } | null = null;
  if (customerId) {
    const canSeeCustomers = await requirePermission("customers", "view");
    if (canSeeCustomers.ok) {
      const { data: cust } = await supabase
        .from("customers")
        .select("full_name, phone")
        .eq("id", customerId)
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .maybeSingle();
      if (cust && cust.phone) recipient = { name: String(cust.full_name ?? ""), phoneDisplay: formatPhoneDisplay(cust.phone as string), stored: cust.phone as string };
    }
  }

  // İYS kapısı (yalnız ticari iletide ve alıcı belliyse).
  let consent: ConsentStatus = null;
  if (recipient && customerId && SHARE_PURPOSE[kind] === "commercial") {
    const { data: row } = await supabase
      .from("iys_consents")
      .select("status")
      .eq("tenant_id", gate.tenantId)
      .eq("customer_id", customerId)
      .eq("channel", "whatsapp")
      .maybeSingle();
    consent = ((row as { status?: string } | null)?.status as ConsentStatus | undefined) ?? null;
  }
  const decision = whatsappShareGate({ purpose: SHARE_PURPOSE[kind], recipientKnown: Boolean(recipient), consent });
  if (!decision.allowed) return { error: decision.reason };

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  const message = buildShareMessage({
    kind,
    officeName: (tenant?.name as string | null | undefined) ?? null,
    recipientName: recipient?.name || null,
    title,
    url,
  });
  const { href } = buildShareHref(recipient?.stored ?? null, message);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "whatsapp.share_prepared",
    entityType: kind === "valuation" ? "valuation" : "presentation",
    entityId: id,
    newValue: { kind, purpose: SHARE_PURPOSE[kind], direct: Boolean(recipient) },
  });

  return {
    ok: true,
    url,
    message,
    waHref: href,
    recipient: recipient ? { name: recipient.name, phoneDisplay: recipient.phoneDisplay } : null,
    note: decision.note,
  };
}
