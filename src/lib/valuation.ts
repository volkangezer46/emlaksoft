import { getEndeksaValuation, isEndeksaConfigured } from "@/lib/integrations/endeksa";
import { getTapusorParcelInsight, isTapusorConfigured } from "@/lib/integrations/tapusor";

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

  // Basit m² × bölgesel katsayı (Endeksa yoksa yedek model)
  const districtFactor =
    input.districtHint?.toLocaleLowerCase("tr-TR").includes("onikişubat") ||
    input.districtHint?.toLocaleLowerCase("tr-TR").includes("merkez")
      ? 42000
      : 35000;
  if (sqm && !isEndeksaConfigured()) {
    const comps = sqm * districtFactor;
    sources.push({
      name: "Emsal m² (iç model)",
      weight: 0.2,
      value: comps,
      note: `~${districtFactor.toLocaleString("tr-TR")} ₺/m² × ${sqm} m²`,
    });
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

  // Makro bant (TÜİK/TCMB proxy — Endeksa/Tapusor yoksa iskelet çarpanı)
  if ((list || sqm) && !isEndeksaConfigured() && !isTapusorConfigured()) {
    const base = list ?? (sqm ? sqm * districtFactor : 0);
    sources.push({
      name: "Makro endeks bandı",
      weight: 0.2,
      value: Math.round(base * 0.97),
      note: "TCMB/TÜİK bağlanınca canlı endeks",
    });
    sources.push({
      name: "Piyasa yumuşatma",
      weight: 0.15,
      value: Math.round(base * 1.03),
      note: "Likidite / pazarlık payı",
    });
  }

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
  const low = Math.round(mid * 0.92);
  const high = Math.round(mid * 1.08);
  const confidence = Math.min(0.95, 0.45 + priceSources.length * 0.12);

  return {
    low,
    mid,
    high,
    confidence,
    sources,
    notes: "Çok kaynaklı ön değerleme — insan onayı önerilir.",
    investmentScore,
    legalFlags,
  };
}
