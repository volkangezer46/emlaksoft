import type { SupabaseClient } from "@supabase/supabase-js";
import { getEndeksForPlace } from "@/lib/integrations/emlakfiyati/client";
import {
  endeksEvidenceLevel,
  mapPropertyTypeToTip,
  toEndeksValuationSource,
  EMLAKFIYATI_SOURCE_NAME,
  type EndeksGuven,
  type EndeksSummary,
} from "@/lib/integrations/emlakfiyati/contract";
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
};

type ComparableConfidence = ComparableEstimate["confidence"] | null;

/**
 * This is an evidence score, not a statistical probability. A seller's list
 * price is only a weak anchor; independent provider data and comparable sales
 * increase the score. Keeping the calculation explicit prevents source count
 * alone from making a single asking price look trustworthy.
 */
export function valuationEvidenceConfidence(input: {
  hasListPrice: boolean;
  comparableConfidence: ComparableConfidence;
  /** EmlakFiyati endeksinin güven kademesi; "none" = kullanılmadı ya da örneklem yetersiz. */
  marketIndex: "none" | EndeksGuven;
}): number {
  const hasComparable = input.comparableConfidence != null && input.comparableConfidence !== "yetersiz";
  const hasMarketIndex = input.marketIndex !== "none";
  const evidenceCount = Number(hasComparable) + Number(hasMarketIndex);
  if (!input.hasListPrice && evidenceCount === 0) return 0;

  let score = 0.15 + (input.hasListPrice ? 0.1 : 0);
  if (input.comparableConfidence === "yüksek") score += 0.55;
  else if (input.comparableConfidence === "orta") score += 0.4;
  else if (input.comparableConfidence === "düşük") score += 0.25;
  if (input.marketIndex === "high") score += 0.2;
  else if (input.marketIndex === "medium") score += 0.15;
  else if (input.marketIndex === "low") score += 0.08;
  if (evidenceCount >= 2) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

export async function estimateMultiSourceValue(input: {
  listPrice: number | null;
  sqm: number | null;
  districtHint: string | null;
  provinceName?: string | null;
  neighborhoodName?: string | null;
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
  /** Emsal düzeltme katsayıları için hedefin kendi özellikleri (opsiyonel). */
  targetFloor?: number | null;
  targetBuildingAge?: number | null;
  targetHeating?: string | null;
  targetFacade?: string | null;
}): Promise<MultiSourceValuation> {
  const sources: ValuationSource[] = [];
  const providerWarnings: string[] = [];
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
      targetFloor: input.targetFloor ?? null,
      targetBuildingAge: input.targetBuildingAge ?? null,
      targetHeating: input.targetHeating ?? null,
      targetFacade: input.targetFacade ?? null,
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

  // EmlakFiyati — aylık bölge endeksi (medyan TL/m²). Yalnız coğrafi yol + tip gider; kişisel veri yok.
  // Kiralık ve desteklenmeyen türlerde (işyeri, dükkan...) kaynak hiç eklenmez (uydurma değer yok).
  let marketSummary: EndeksSummary | null = null;
  const tip = mapPropertyTypeToTip(input.propertyType, input.transactionType);
  if (input.provinceName && sqm && tip) {
    try {
      const lookup = await getEndeksForPlace({
        province: input.provinceName,
        district: input.districtHint,
        neighborhood: input.neighborhoodName,
        tip,
      });
      if (lookup.status === "ok") {
        const source = toEndeksValuationSource(lookup.summary, sqm);
        if (source) {
          sources.push(source);
          marketSummary = lookup.summary;
        } else {
          providerWarnings.push("EmlakFiyati geçerli bir değer döndürmedi");
        }
      } else if (lookup.status === "error") {
        providerWarnings.push("EmlakFiyati verisi alınamadı");
      }
      // "empty": bu bölge/tip için veri yok; "disabled": anahtar tanımlı değil — ikisi de sessizce atlanır.
    } catch (e) {
      console.error("valuation provider unavailable", {
        provider: "emlakfiyati",
        errorType: e instanceof Error ? e.name : "UnknownError",
      });
      providerWarnings.push("EmlakFiyati verisi alınamadı");
    }
  }

  if (providerWarnings.length > 0) {
    sources.push({
      name: "Kaynak kullanılabilirlik uyarısı",
      weight: 0,
      value: 0,
      note: `${providerWarnings.join("; ")}. Sonuç bu kaynaklar hesaba katılmadan üretildi.`,
    });
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
      confidence: 0,
      sources,
      notes: "Yeterli fiyat kanıtı yok — liste fiyatı girin veya konum, m² ve yeterli emsal sağlayın.",
    };
  }

  const totalW = priceSources.reduce((s, x) => s + x.weight, 0);
  const mid = Math.round(priceSources.reduce((s, x) => s + x.value * x.weight, 0) / totalW);

  // Aralık yalnız gözlemlenebilir bir yayılım olduğunda üretilir: ya emsal
  // kümesinin gerçek yayılımı ya da en az iki fiyat kaynağının anlaşmazlığı.
  // Tek liste fiyatının etrafında yapay bir ±% bandı göstermek güven yanılsaması
  // üretirdi; bu durumda alt/üst sınırlar bilinçli olarak null kalır.
  const spread = comparables?.spreadPct ?? null;
  const observedBand = spread !== null && spread >= 0
    ? spread / 200
    : priceSources.length >= 2
      ? (Math.max(...priceSources.map((source) => source.value)) - Math.min(...priceSources.map((source) => source.value))) / (2 * mid)
      : null;
  const band = observedBand === null ? null : Math.min(Math.max(observedBand, 0.03), 0.2);
  const low = band === null ? null : Math.round(mid * (1 - band));
  const high = band === null ? null : Math.round(mid * (1 + band));

  const hasMarketIndex = priceSources.some((source) => source.name === EMLAKFIYATI_SOURCE_NAME);
  const confidence = valuationEvidenceConfidence({
    hasListPrice: list !== null,
    comparableConfidence: comparables?.confidence ?? null,
    marketIndex: hasMarketIndex ? endeksEvidenceLevel(marketSummary) : "none",
  });

  const notes = comparables && comparables.confidence !== "yetersiz"
    ? `${comparables.compCount} emsal üzerinden hesaplandı (${comparables.wonCount} gerçekleşen satış). İnsan onayı önerilir.`
    : priceSources.length === 1 && priceSources[0]?.name === "Ofis liste fiyatı"
      ? "Bağımsız emsal bulunamadı; orta değer yalnız ofis liste fiyatıdır ve güvenilir bir piyasa bandı üretilemez. İnsan onayı gerekli."
      : "Emsal bulunamadı; tahmin mevcut bağımsız dış kaynaklara ve varsa liste fiyatına dayanıyor. İnsan onayı gerekli.";

  return {
    low,
    mid,
    high,
    confidence,
    sources,
    notes,
  };
}
