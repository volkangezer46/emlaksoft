import type { SupabaseClient } from "@supabase/supabase-js";
import { getEndeksaValuation, isEndeksaConfiguredFull } from "@/lib/integrations/endeksa";
import { getTapusorParcelInsight, isTapusorConfiguredFull } from "@/lib/integrations/tapusor";
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
  hasEndeksa: boolean;
  hasTapusor: boolean;
}): number {
  const hasComparable = input.comparableConfidence != null && input.comparableConfidence !== "yetersiz";
  const evidenceCount = Number(hasComparable) + Number(input.hasEndeksa) + Number(input.hasTapusor);
  if (!input.hasListPrice && evidenceCount === 0) return 0;

  let score = 0.15 + (input.hasListPrice ? 0.1 : 0);
  if (input.comparableConfidence === "yüksek") score += 0.55;
  else if (input.comparableConfidence === "orta") score += 0.4;
  else if (input.comparableConfidence === "düşük") score += 0.25;
  if (input.hasEndeksa) score += 0.2;
  if (input.hasTapusor) score += 0.15;
  if (evidenceCount >= 2) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

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

  // Endeksa — canlı bölge endeksi + AVM
  if (input.provinceName) {
    try {
      if (await isEndeksaConfiguredFull()) {
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
        } else {
          providerWarnings.push("Endeksa geçerli bir değer döndürmedi");
        }
      }
    } catch (e) {
      console.error("valuation provider unavailable", {
        provider: "endeksa",
        errorType: e instanceof Error ? e.name : "UnknownError",
      });
      providerWarnings.push("Endeksa verisi alınamadı");
    }
  }

  let investmentScore: number | null = null;
  let legalFlags: string[] = [];

  // Tapusor — EDİ yapay zeka değerlemesi + yatırım puanı + hukuki uyarı
  if (input.provinceName) {
    try {
      if (await isTapusorConfiguredFull()) {
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
        } else {
          providerWarnings.push("Tapusor geçerli bir değer döndürmedi");
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
        } else if (legalFlags.length > 0) {
          sources.push({
            name: "Tapusor hukuki/teknik uyarıları",
            weight: 0,
            value: 0,
            note: legalFlags.join(", "),
          });
        }
      }
    } catch (e) {
      console.error("valuation provider unavailable", {
        provider: "tapusor",
        errorType: e instanceof Error ? e.name : "UnknownError",
      });
      providerWarnings.push("Tapusor verisi alınamadı");
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
      investmentScore,
      legalFlags,
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

  const hasEndeksa = priceSources.some((source) => source.name === "Endeksa bölge endeksi");
  const hasTapusor = priceSources.some((source) => source.name === "Tapusor EDİ değerleme");
  const confidence = valuationEvidenceConfidence({
    hasListPrice: list !== null,
    comparableConfidence: comparables?.confidence ?? null,
    hasEndeksa,
    hasTapusor,
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
    investmentScore,
    legalFlags,
  };
}
