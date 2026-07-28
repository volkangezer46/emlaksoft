"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { estimateMultiSourceValue } from "@/lib/valuation";
import { intakeLead } from "@/lib/lead-intake";
import { compareTr } from "@/lib/tr-text";
import { publicValuationSourceEntry } from "@/lib/public-valuation-source";

/**
 * "Evim ne kadar eder?" — /vitrin/[slug]/degerleme public satıcı hunisi.
 *
 * NEDEN service_role: Sayfa herkese açık, oturum yok. Token'lı public sayfalar
 * (vitrin, lead) gibi createAdminClient kullanılır; tenant slug'dan çözülür ve
 * dışarıya YALNIZCA toplulaştırılmış aralık döner — tek tek portföy/fiyat
 * verisi sızmaz.
 *
 * Değerleme mevcut motoru yeniden kullanır (estimateMultiSourceValue →
 * emsal RPC + Endeksa + Tapusor). Emsal çıkmazsa ilçe medyanı (region_stats)
 * son çare; o da yoksa dürüstçe "yeterli veri yok" denir.
 */

export type PublicGeoOption = { id: string; name: string };

/** İl seçilince ilçeleri getirir. geo_* kiracıya özel veri içermez. */
export async function listPublicDistricts(provinceId: string): Promise<PublicGeoOption[]> {
  if (!provinceId) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("geo_districts")
    .select("id, name")
    .eq("province_id", provinceId)
    .eq("is_active", true);

  if (error || !data) return [];
  // Türkçe harf sırası DB'de değil burada (geo.ts ile aynı gerekçe).
  return data.sort((a, b) => compareTr(a.name, b.name));
}

export type PublicEstimateInput = {
  slug: string;
  provinceId: string;
  districtId: string;
  propertyType: string;
  sqm: number;
  rooms?: string;
  buildingAge?: string;
  kvkk: boolean;
  /** Honeypot — botlar doldurur, gerçek kullanıcı görmez. */
  website?: string;
};

export type PublicEstimateResult =
  | { ok: false; error: string }
  | { ok: true; sufficient: false }
  | { ok: true; sufficient: true; low: number; high: number; note: string };

/** Aralığı 50.000 ₺ adıma yuvarlar — kesin fiyat izlenimi vermesin. */
function roundBand(low: number, high: number): { low: number; high: number } {
  const step = 50_000;
  const l = Math.max(step, Math.floor(low / step) * step);
  const h = Math.max(l + step, Math.ceil(high / step) * step);
  return { low: l, high: h };
}

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel): string | null {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

export async function estimatePublicValuation(
  input: PublicEstimateInput,
): Promise<PublicEstimateResult> {
  // Honeypot dolduysa API'ye inmeden "veri yok" göster — bot ayrımı belli olmasın.
  if ((input.website ?? "").trim()) return { ok: true, sufficient: false };
  if (!input.kvkk) return { ok: false, error: "Devam etmek için KVKK onayı gerekli." };

  const slug = (input.slug ?? "").trim();
  const propertyType = (input.propertyType ?? "").trim().slice(0, 40);
  const sqm = Number(input.sqm);
  if (!slug || !input.provinceId || !input.districtId || !propertyType) {
    return { ok: false, error: "Lütfen il, ilçe ve mülk tipini seçin." };
  }
  if (!Number.isFinite(sqm) || sqm < 20 || sqm > 5000) {
    return { ok: false, error: "Geçerli bir brüt m² girin (20–5000)." };
  }

  const admin = createAdminClient();

  const [{ data: tenant }, { data: district }] = await Promise.all([
    admin.from("tenants").select("id, name").eq("slug", slug).maybeSingle(),
    admin
      .from("geo_districts")
      .select("id, name, province_id, province:geo_provinces(name)")
      .eq("id", input.districtId)
      .maybeSingle(),
  ]);

  if (!tenant) return { ok: false, error: "Ofis bulunamadı." };
  if (!district || district.province_id !== input.provinceId) {
    return { ok: false, error: "İl/ilçe seçimi geçersiz." };
  }

  const provinceName = relName(district.province as Rel);

  // Mevcut karma motor: emsal (kendi verimiz) + varsa Endeksa/Tapusor.
  // Public bağlamda liste fiyatı yok — motor yalnızca bağımsız kaynaklarla çalışır.
  const est = await estimateMultiSourceValue({
    listPrice: null,
    sqm,
    districtHint: district.name,
    provinceName,
    supabase: admin,
    tenantId: tenant.id,
    districtId: district.id,
    propertyType,
    transactionType: "Satılık",
  });

  if (est.low != null && est.high != null && est.mid != null) {
    const band = roundBand(est.low, est.high);
    return { ok: true, sufficient: true, low: band.low, high: band.high, note: est.notes };
  }

  // Son çare: ilçe geneli medyan ₺/m² (region_stats — yine tenant'ın kendi verisi).
  // Mülk tipi ayrımı yapmaz; bu yüzden yalnız yeterli örneklemde kullanılır.
  const { data: stats } = await admin.rpc("region_stats", {
    p_tenant_id: tenant.id,
    p_transaction_type: "Satılık",
    p_months_back: 12,
  });
  const row = (stats as { district_id: string; median_sqm_price: number | null; total_count: number }[] | null)?.find(
    (r) => r.district_id === district.id,
  );
  if (row?.median_sqm_price != null && Number(row.median_sqm_price) > 0 && Number(row.total_count) >= 3) {
    const mid = Number(row.median_sqm_price) * sqm;
    const band = roundBand(mid * 0.9, mid * 1.1);
    return {
      ok: true,
      sufficient: true,
      low: band.low,
      high: band.high,
      note: "İlçe geneli medyan m² fiyatına dayalı kaba tahmin. İnsan onayı önerilir.",
    };
  }

  return { ok: true, sufficient: false };
}

export type PublicValuationLeadInput = {
  slug: string;
  fullName: string;
  phone: string;
  provinceId: string;
  districtId: string;
  propertyType: string;
  sqm: number;
  rooms?: string;
  buildingAge?: string;
  /** Sonuç ekranında gösterilen aralık — mesaja yazılır; yoksa "veri yetersiz". */
  low?: number | null;
  high?: number | null;
  website?: string;
};

export type PublicValuationLeadResult = { ok: true } | { ok: false; error: string };

const moneyTr = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";

export async function submitValuationLead(
  input: PublicValuationLeadInput,
): Promise<PublicValuationLeadResult> {
  // Honeypot: botlara sessizce "başarılı" de.
  if ((input.website ?? "").trim()) return { ok: true };

  const slug = (input.slug ?? "").trim();
  const fullName = (input.fullName ?? "").trim().slice(0, 120);
  if (!slug || !fullName) return { ok: false, error: "Ad soyad zorunlu." };
  if (!(input.phone ?? "").trim()) return { ok: false, error: "Telefon zorunlu." };

  const admin = createAdminClient();
  const [{ data: tenant }, { data: district }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, lead_capture_token, lead_capture_enabled")
      .eq("slug", slug)
      .maybeSingle(),
    admin
      .from("geo_districts")
      .select("id, name, province:geo_provinces(name)")
      .eq("id", input.districtId)
      .maybeSingle(),
  ]);

  if (!tenant?.lead_capture_token || tenant.lead_capture_enabled === false) {
    return { ok: false, error: "Talep formu şu anda kapalı." };
  }

  const propertyType = (input.propertyType ?? "").trim().slice(0, 40) || "Daire";
  const sqm = Number(input.sqm);
  const loc = [district?.name, relName((district?.province ?? null) as Rel)].filter(Boolean).join(" / ");
  const parts = [
    loc || null,
    propertyType,
    Number.isFinite(sqm) && sqm > 0 ? `${sqm} m²` : null,
    input.rooms ? `${String(input.rooms).slice(0, 20)} oda` : null,
    input.buildingAge ? `bina yaşı ${String(input.buildingAge).slice(0, 20)}` : null,
  ].filter(Boolean);
  const range =
    input.low != null && input.high != null && input.low > 0
      ? `Ön tahmin: ${moneyTr(input.low)} – ${moneyTr(input.high)}`
      : "Ön tahmin üretilemedi (bölge verisi yetersiz)";
  const message = `Değerleme talebi: ${parts.join(", ")}. ${range}. Satıcı net değerleme için aranmak istiyor.`;

  // Mevcut public lead yolu: intakeLead (mükerrer kontrolü, atama, bildirim dahil).
  const result = await intakeLead(tenant.lead_capture_token, {
    fullName,
    phone: input.phone,
    message,
    source: "degerleme",
    channel: "web_form",
    transactionType: "satilik",
    propertyType,
    // Değerleme hunisinden gelen kişi satıcıdır — tanımlardaki gerçek değer 'Satıcı'
    // (definitions seed: 'Alıcı', 'Satıcı', 'Kiracı', 'Mülk sahibi', 'Yatırımcı').
    customer_types: ["Satıcı"],
    provinceId: input.provinceId || undefined,
    rooms: input.rooms ? String(input.rooms).slice(0, 20) : undefined,
  });

  if (!result.ok) return { ok: false, error: result.error };

  /*
   * DEĞERLEME KAYDI (denetim P0): hesaplanan aralık eskiden yalnızca yukarıdaki
   * serbest metne gömülüyordu; `valuations` tablosuna satır atılmıyor, m²/ilçe
   * yapısal saklanmıyordu. Artık lead ile birlikte gerçek bir değerleme kaydı
   * açılıyor — danışman /app/degerleme'den açıp kriterleri elle girmeden rapor
   * üretebiliyor.
   *
   * Aralık üretilememiş olsa bile (bölge verisi yetersiz) kayıt AÇILIR: asıl
   * değer kriterlerin yapısal saklanması; tahmin alanları null kalır ve
   * `confidence` 0 yazılır (dürüst sinyal).
   *
   * `created_by` null + `property_id` null → vitrin kaynağı mevcut kolonlarla
   * ayırt edilebilir; kriter dökümü `sources` içinde (lib/public-valuation-source.ts).
   *
   * Best-effort: burada bir hata olursa lead ZATEN kaydedildi; talebi kaybetmemek
   * için hata yutulur, ama loglanır.
   */
  const provinceName = relName((district?.province ?? null) as Rel);
  const baslikYeri = loc || provinceName || "Konum belirtilmedi";
  const { error: valErr } = await admin.from("valuations").insert({
    tenant_id: tenant.id,
    property_id: null,
    title: `Vitrin değerleme talebi · ${baslikYeri} · ${propertyType}`,
    estimated_low: input.low != null && input.low > 0 ? input.low : null,
    estimated_mid:
      input.low != null && input.high != null && input.low > 0 ? Math.round((input.low + input.high) / 2) : null,
    estimated_high: input.high != null && input.high > 0 ? input.high : null,
    // Public huni bağımsız kaynak sayısını dışarı vermiyor; ön tahmin varsa
    // düşük güven (0.3), yoksa 0. Danışman raporu bunu ezecek.
    confidence: input.low != null && input.high != null && input.low > 0 ? 0.3 : 0,
    sources: [
      publicValuationSourceEntry({
        origin: "vitrin",
        slug,
        customer_id: result.customerId,
        province_id: input.provinceId || null,
        district_id: input.districtId || null,
        district_name: district?.name ?? null,
        province_name: provinceName,
        property_type: propertyType,
        sqm: Number.isFinite(sqm) && sqm > 0 ? sqm : null,
        rooms: input.rooms ? String(input.rooms).slice(0, 20) : null,
        building_age: input.buildingAge ? String(input.buildingAge).slice(0, 20) : null,
        transaction_type: "Satılık",
      }),
    ],
    notes: `${message} Kaynak: vitrin değerleme formu. İnsan onayı gerekir.`,
    created_by: null,
  });
  if (valErr) console.error("submitValuationLead valuation insert", valErr);

  return { ok: true };
}
