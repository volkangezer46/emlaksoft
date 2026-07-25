import type { SupabaseClient } from "@supabase/supabase-js";
import { getEndeksaValuation, isEndeksaConfigured } from "@/lib/integrations/endeksa";
import { getTapusorParcelInsight, isTapusorConfigured } from "@/lib/integrations/tapusor";
import { estimateFromComparables, type ComparableEstimate } from "@/lib/comparables";

export type ValuationSource = {
  name: string;
  weight: number;
  value: number;
  note: string;
};

export type MultiSourceValuation = {
  low: number | null;
  mid: number | null;
  high: number | null;
  confidence: number;
  sources: ValuationSource[];
  notes: string;
  investmentScore: number | null;
  legalFlags: string[];
};

export async function estimateMultiSourceValue(input: {
  listPrice: number | null;
  sqm: number | null;
  districtHint: string | null;
  provinceName?: string | null;
  ada?: string | null;
  parsel?: string | null;
  /**
   * Yerli emsal motoru için gerekenler. Verilirse kendi verimizden gerçek
   * emsal analizi yapılır ve EN YÜKSEK ağırlığı alır.
   */
  supabase?: SupabaseClient;
  tenantId?: string | null;
  districtId?: string | null;
  propertyType?: string | null;
  transactionType?: string | null;
  excludePropertyId?: string | null;
}): Promise<MultiSourceValuation> {
  const sources: ValuationSource[] = [];
  const list = input.listPrice && input.listPrice > 0 ? input.listPrice : null;
  const sqm = input.sqm && input.sqm > 0 ? input.sqm : null;

  // Kendi liste fiyatı
  if (list) {
    sources.push({
      name: "Ofis liste fiyatı",
      weight: 0.25,
      value: list,
      note: "Portföy / girilen liste",
    });
  }

  // ---- Yerli emsal motoru (dış API'siz, en güvenilir iç kaynak) ----------
  //
  // Bu blok, eskiden burada duran UYDURMA modelin yerini aldı. Öncesinde
  // ilçe adında "onikişubat"/"merkez" geçiyorsa 42.000, geçmiyorsa 35.000 ₺/m²
  // gibi sabit bir katsayı kullanılıyordu — hiçbir veriye dayanmayan bir sayı
  // kullanıcıya "emsal m²" adıyla gösteriliyordu. Artık gerçek emsaller:
  // kazanılmış anlaşmalar + aktif portföy, ilçe/tip/m² bandına göre.
  let comparables: ComparableEstimate | null = null;
  if (input.supabase && input.tenantId && sqm) {
    comparables = await estimateFromComparables(input.supabase, {
      tenantId: input.tenantId,
      districtId: input.districtId ?? null,
      propertyType: input.propertyType ?? null,
      transactionType: input.transactionType ?? null,
      sqm,
      excludePropertyId: input.excludePropertyId ?? null,
    });

    if (comparables.estimatedValue && comparables.confidence !== "yetersiz") {
      // Ağırlık güvene bağlı: az emsalle sonucu domine etmesin.
      const weight =
        comparables.confidence === "yüksek" ? 0.5 : comparables.confidence === "orta" ? 0.35 : 0.15;
      sources.push({
        name: "Emsal analizi (kendi verimiz)",
        weight,
        value: comparables.estimatedValue,
        note: `${comparables.compCount} emsal (${comparables.wonCount} kapanmış satış) · medyan ${comparables.medianSqmPrice?.toLocaleString("tr-TR")} ₺/m² · güven: ${comparables.confidence}`,
      });
    }
  }

  // Endeksa — canlı bölge endeksi + AVM
  if (isEndeksaConfigured() && input.provinceName) {
    try {
      const ev = await getEndeksaValuation({
        provinceName: input.provinceName,
        districtName: input.districtHint,
        sqm,
      });
      if (ev.valueAvg > 0) {
        sources.push({
          name: "Endeksa bölge endeksi",
          weight: 0.4,
          value: ev.valueAvg,
          note:
            ev.priceChange12m != null
              ? `12 aylık değişim %${ev.priceChange12m} · canlı API`
              : "Endeksa canlı veri",
        });
      }
    } catch (e) {
      console.error("endeksa valuation", e);
    }
  }

  let investmentScore: number | null = null;
  let legalFlags: string[] = [];

  // Tapusor — EDİ yapay zeka değerlemesi + yatırım puanı + hukuki uyarı
  if (isTapusorConfigured() && input.provinceName) {
    try {
      const ti = await getTapusorParcelInsight({
        provinceName: input.provinceName,
        districtName: input.districtHint,
        ada: input.ada,
        parsel: input.parsel,
      });
      if (ti.estimatedValue) {
        sources.push({
          name: "Tapusor EDİ değerleme",
          weight: 0.3,
          value: ti.estimatedValue,
          note: "Yapay zeka destekli parsel değerlemesi",
        });
      }
      investmentScore = ti.investmentScore;
      legalFlags = ti.legalFlags;
      if (investmentScore != null) {
        sources.push({
          name: "Tapusor yatırım puanı",
          weight: 0,
          value: investmentScore,
          note: legalFlags.length ? legalFlags.join(", ") : "Hukuki/teknik uyarı yok",
        });
      }
    } catch (e) {
      console.error("tapusor insight", e);
    }
  }

  // NOT — buradan iki "kaynak" kaldırıldı: "Makro endeks bandı" (= liste × 0,97)
  // ve "Piyasa yumuşatma" (= liste × 1,03). İkisi de liste fiyatının yeniden
  // etiketlenmiş hâliydi; bağımsız kaynak gibi gösterilip ağırlık alıyorlardı.
  // Bu, değerlemeyi olduğundan güvenilir gösteriyordu. Gerçek bağımsız iç
  // kaynak artık emsal analizi; o da yeterli emsal yoksa hiç görünmüyor.

  const priceSources = sources.filter((s) => s.weight > 0);
  if (priceSources.length === 0) {
    return {
      low: null,
      mid: null,
      high: null,
      confidence: 0.2,
      sources,
      notes: "Yeterli girdi yok — liste fiyatı veya m² girin.",
      investmentScore,
      legalFlags,
    };
  }

  const totalW = priceSources.reduce((s, x) => s + x.weight, 0);
  const mid = Math.round(priceSources.reduce((s, x) => s + x.value * x.weight, 0) / totalW);

  // Aralık: emsal yayılımı biliniyorsa ONU kullan (gerçek veri), yoksa ±%8
  // varsayılanı. Sabit ±%8 her zaman aynı genişlikte bant üretiyordu — emsaller
  // birbirine çok yakınken bile "geniş belirsizlik" gösteriyordu.
  const spread = comparables?.spreadPct ?? null;
  const band = spread !== null && spread > 0 ? Math.min(Math.max(spread / 200, 0.03), 0.2) : 0.08;
  const low = Math.round(mid * (1 - band));
  const high = Math.round(mid * (1 + band));

  // Güven: kaynak sayısı + emsal motorunun kendi güveni birlikte
  let confidence = Math.min(0.9, 0.4 + priceSources.length * 0.12);
  if (comparables) {
    if (comparables.confidence === "yüksek") confidence = Math.min(0.95, confidence + 0.15);
    else if (comparables.confidence === "yetersiz") confidence = Math.max(0.25, confidence - 0.15);
  }

  const notes = comparables && comparables.confidence !== "yetersiz"
    ? `${comparables.compCount} emsal üzerinden hesaplandı (${comparables.wonCount} gerçekleşen satış). İnsan onayı önerilir.`
    : "Emsal bulunamadı; tahmin liste fiyatı ve varsa dış kaynaklara dayanıyor. İnsan onayı gerekli.";

  return {
    low,
    mid,
    high,
    confidence,
    sources,
    notes,
    investmentScore,
    legalFlags,
  };
}
