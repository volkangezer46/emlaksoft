"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { notifyTenant } from "@/lib/notify";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { formatPhoneDisplay, PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isPast } from "@/lib/clock";
import { getDistrict, getProvince } from "@/lib/geo/reader";

/**
 * Vitrin public etkileşimleri — kayıtlı arama + paylaşım beğenisi.
 *
 * NEDEN service_role: Bu action'lar herkese açık sayfalardan (vitrin, paylas)
 * oturumsuz çağrılır — public-valuation.ts ile aynı desen. Tenant slug/token
 * üzerinden çözülür, IP bazlı hız sınırı + honeypot + KVKK kapıları uygulanır
 * ve dışarıya hiçbir kiracı verisi dönmez (yalnızca ok/error).
 */

export type SavedSearchInput = {
  slug: string;
  name?: string;
  phone: string;
  txType: string; // 'satilik' | 'kiralik'
  provinceId: string;
  districtId?: string;
  minPrice?: string;
  maxPrice?: string;
  rooms?: string;
  kvkk: boolean;
  /** Honeypot — botlar doldurur, gerçek kullanıcı görmez. */
  website?: string;
};

export type SavedSearchResult = { ok: true } | { ok: false; error: string };

/** "1.500.000" gibi girdiyi sayıya çevirir; geçersiz/negatifse null. */
function parseMoney(v?: string): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function createVitrinSavedSearch(input: SavedSearchInput): Promise<SavedSearchResult> {
  // Honeypot dolduysa sessizce "başarılı" — bot ayrımı belli olmasın.
  if ((input.website ?? "").trim()) return { ok: true };
  if (!input.kvkk) return { ok: false, error: "Devam etmek için KVKK onayı gerekli." };

  const slug = (input.slug ?? "").trim();
  const txType = input.txType === "kiralik" ? "kiralik" : input.txType === "satilik" ? "satilik" : null;
  const phoneParsed = parsePhoneStrict(input.phone);
  const phone = phoneParsed.stored;

  if (!slug || !txType || !input.provinceId) {
    return { ok: false, error: "Lütfen işlem türü ve il seçin." };
  }
  if (!phoneParsed.ok) {
    return { ok: false, error: phoneParsed.error ?? PHONE_ERROR_MESSAGE };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`vitrin-saved-search:${ip}`, {
    limit: 5,
    windowSec: 3600,
    failurePolicy: "deny",
  });
  if (!allowed) return { ok: false, error: "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name, status").eq("slug", slug).maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return { ok: false, error: "Ofis bulunamadı." };

  // il/ilçe tutarlılığı — ilçe seçildiyse seçilen ile ait olmalı
  const province = await getProvince(input.provinceId);
  if (!province) return { ok: false, error: "İl seçimi geçersiz." };

  let districtId: string | null = null;
  let districtName: string | null = null;
  if (input.districtId) {
    const district = await getDistrict(input.districtId);
    if (!district || district.provinceId !== province.id) {
      return { ok: false, error: "İl/ilçe seçimi geçersiz." };
    }
    districtId = district.id;
    districtName = district.name;
  }

  const minPrice = parseMoney(input.minPrice);
  const maxPrice = parseMoney(input.maxPrice);
  const name = (input.name ?? "").trim().slice(0, 80) || null;
  const rooms = (input.rooms ?? "").trim().slice(0, 20) || null;

  const { error } = await admin.from("vitrin_saved_searches").insert({
    tenant_id: tenant.id,
    name,
    phone,
    tx_type: txType,
    province_id: province.id,
    district_id: districtId,
    min_price: minPrice,
    max_price: maxPrice,
    rooms,
    kvkk_at: new Date().toISOString(),
  });
  if (error) {
    console.error("createVitrinSavedSearch insert", error.message);
    return { ok: false, error: "Kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Ofise bildirim — user_id null: tüm ekip görür, danışman sıcakken arayabilir.
  const loc = [districtName, province.name].filter(Boolean).join(", ");
  const criteria = [
    txType === "kiralik" ? "Kiralık" : "Satılık",
    loc,
    rooms,
    minPrice != null || maxPrice != null
      ? `${minPrice != null ? new Intl.NumberFormat("tr-TR").format(minPrice) : "…"} – ${maxPrice != null ? new Intl.NumberFormat("tr-TR").format(maxPrice) : "…"} ₺`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  await notifyTenant({
    tenantId: tenant.id,
    title: "Kayıtlı arama bırakıldı",
    body: `${name ?? "Bir ziyaretçi"} vitrinde arama kaydetti (${criteria}). Telefon: ${formatPhoneDisplay(phone)}`,
    href: "/app/talepler",
    kind: "info",
    prefKey: "savedSearch",
  });

  return { ok: true };
}

export type ShareLikeResult = { ok: true } | { ok: false; error: string };

/**
 * /paylas/[token] "Beğendim" mikro-butonu: paylaşım sahibine (linki oluşturan
 * danışmana) bildirim yazar. IP+token bazlı hız sınırı ile spam frenlenir.
 */
export async function likePublicShare(token: string): Promise<ShareLikeResult> {
  const cleanToken = (token ?? "").trim();
  if (!cleanToken || cleanToken.length > 128) return { ok: false, error: "Geçersiz bağlantı." };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`share-like:${ip}:${cleanToken.slice(0, 24)}`, {
    limit: 2,
    windowSec: 86_400,
    failurePolicy: "deny",
  });
  if (!allowed) return { ok: true }; // zaten iletildi — ziyaretçiye hata gösterme

  const admin = createAdminClient();
  const { data: share } = await admin
    .from("share_links")
    .select("id, tenant_id, entity_type, entity_id, expires_at, created_by, tenant:tenants(status)")
    .eq("token", cleanToken)
    .maybeSingle();
  const shareTenant = share && (Array.isArray(share.tenant) ? share.tenant[0] : share.tenant);
  if (
    !share ||
    share.entity_type !== "property" ||
    isPast(share.expires_at) ||
    !shareTenant ||
    !isPublicTenantActive(shareTenant.status)
  ) {
    return { ok: false, error: "Geçersiz bağlantı." };
  }

  const [{ data: property }, { data: creator }] = await Promise.all([
    admin
      .from("properties")
      .select("title, property_code")
      .eq("id", share.entity_id)
      .eq("tenant_id", share.tenant_id)
      .is("deleted_at", null)
      .maybeSingle(),
    share.created_by
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", share.created_by)
          .eq("tenant_id", share.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!property) return { ok: false, error: "Geçersiz bağlantı." };
  const label = property?.title || property?.property_code || "Portföy";

  await notifyTenant({
    tenantId: share.tenant_id,
    userId: creator?.id ?? null,
    title: "Paylaşımınız beğenildi",
    body: `"${label}" paylaşım linkini açan ziyaretçi Beğendim'e tıkladı. İlgi sıcak — arama zamanı.`,
    href: `/app/portfoyler/${share.entity_id}`,
    kind: "success",
    prefKey: "share",
  });

  return { ok: true };
}
