"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isValidTurkishMobile, normalizeTurkishPhone, formatTurkishPhone } from "@/lib/phone";

/**
 * Vitrin fiyat alarmı — "Fiyat düşünce haber ver".
 *
 * vitrin.ts (kayıtlı arama) ile aynı public-action deseni: oturumsuz çağrılır,
 * tenant slug'dan çözülür, IP hız sınırı + honeypot + KVKK kapıları uygulanır,
 * dışarıya kiracı verisi sızmaz (yalnız ok/error). Ziyaretçiye SMS atılmaz —
 * fiyat düşünce günlük cron (/api/cron/vitrin-alarm) OFİSE "arayın" bildirimi
 * yazar; alarm anındaki fiyat baseline_price olarak saklanır (price_history yok).
 */

export type PriceAlertInput = {
  slug: string;
  propertyId: string;
  name?: string;
  phone: string;
  kvkk: boolean;
  /** Honeypot — botlar doldurur, gerçek kullanıcı görmez. */
  website?: string;
};

export type PriceAlertResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createVitrinPriceAlert(input: PriceAlertInput): Promise<PriceAlertResult> {
  // Honeypot dolduysa sessizce "başarılı" — bot ayrımı belli olmasın.
  if ((input.website ?? "").trim()) return { ok: true };
  if (!input.kvkk) return { ok: false, error: "Devam etmek için KVKK onayı gerekli." };

  const slug = (input.slug ?? "").trim();
  const propertyId = (input.propertyId ?? "").trim();
  if (!slug || !UUID_RE.test(propertyId)) return { ok: false, error: "Geçersiz ilan." };

  const phone = normalizeTurkishPhone(input.phone);
  if (!isValidTurkishMobile(phone)) {
    return { ok: false, error: "Geçerli bir cep telefonu girin (05XX XXX XX XX)." };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`vitrin-price-alert:${ip}`, { limit: 5, windowSec: 3600 });
  if (!allowed) return { ok: false, error: "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name").eq("slug", slug).maybeSingle();
  if (!tenant) return { ok: false, error: "Ofis bulunamadı." };

  // İlan bu tenant'a ait, yayında ve fiyatlı olmalı — baseline fiyatsız alarm anlamsız.
  const { data: property } = await admin
    .from("properties")
    .select("id, title, property_code, list_price")
    .eq("id", propertyId)
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) return { ok: false, error: "İlan bulunamadı." };
  const price = property.list_price != null ? Number(property.list_price) : null;
  if (price == null || !(price > 0)) {
    return { ok: false, error: "Bu ilanda liste fiyatı olmadığından alarm kurulamıyor." };
  }

  // Mükerrer freni: aynı telefon + aynı ilan için bekleyen alarm varsa yenisi açılmaz.
  const { data: existing } = await admin
    .from("vitrin_price_alerts")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("property_id", property.id)
    .eq("phone", phone)
    .is("notified_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true }; // zaten kurulu — ziyaretçiye aynı başarı ekranı

  const name = (input.name ?? "").trim().slice(0, 80) || null;
  const { error } = await admin.from("vitrin_price_alerts").insert({
    tenant_id: tenant.id,
    property_id: property.id,
    name,
    phone,
    baseline_price: price,
    kvkk_at: new Date().toISOString(),
  });
  if (error) {
    console.error("createVitrinPriceAlert insert", error.message);
    return { ok: false, error: "Kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Ofise bildirim — user_id null: tüm ekip görür, sıcak ilgi sinyali.
  const label = property.title || property.property_code;
  await notifyTenant({
    tenantId: tenant.id,
    title: `Fiyat alarmı: ${label} için ${name ?? "bir ziyaretçi"}`,
    body: `Vitrinde fiyat düşüş alarmı kuruldu (baz: ${new Intl.NumberFormat("tr-TR").format(price)} ₺). Telefon: ${formatTurkishPhone(phone)}`,
    href: `/app/portfoyler/${property.id}`,
    kind: "info",
    prefKey: "priceDrop",
  });

  return { ok: true };
}
