/**
 * "Neden satmıyor?" satış-performansı teşhisi.
 *
 * Portföy sağlık skoru (property-health.ts) ilanın EKSİKSİZLİĞİNİ ölçer; bu motor
 * ise CANLI bir ilanın neden SATILAMADIĞINI teşhis eder — piyasada geçen süre,
 * emsal-üstü fiyat, portal görünürlüğü, fotoğraf ve görüntülenme hızını harmanlar.
 * Saf/deterministik: sunucu bileşeninde önceden hesaplanmış sinyalleri alır, DB
 * sorgusu yapmaz. Yalnızca aktif satış/kiralamadaki ilanlar için anlamlıdır.
 */

export type SaleBlocker = {
  key: string;
  severity: "critical" | "warning";
  title: string; // sorun
  detail: string; // neden önemli
  action: string; // önerilen düzeltme
};

export type SaleDiagnosis = {
  verdict: "healthy" | "needs_attention" | "at_risk";
  score: number; // 0–100 satışa hazırlık
  blockers: SaleBlocker[]; // önceliğe göre sıralı (critical önce)
  positives: string[]; // iyi giden yönler
};

export type SaleDiagnosticsInput = {
  /** İlan durumu — yalnızca aktif pazarlamadaki ilanlar teşhis edilir. */
  status: string;
  /** Piyasada geçen gün (published_at ?? created_at üzerinden). */
  daysOnMarket: number;
  /** Emsal fiyat bandı (computePriceHealth çıktısı). */
  priceHealth: "green" | "yellow" | "red" | "pending";
  /** Emsal ortasına göre sapma yüzdesi (+ = üstünde). */
  priceDeltaPct: number | null;
  /** Toplam vitrin görüntülenme. */
  totalViews: number;
  /** Son 7 gün görüntülenme. */
  views7d: number;
  /** Canlı (status='live') portal ilan sayısı. */
  livePortals: number;
  /** Portföye bağlı medya (fotoğraf/dosya) sayısı. */
  mediaCount: number;
  /** İşlem türü — metinleri satış/kiralamaya göre uyarlar. */
  transactionType?: string | null;
  /** Bölgenin (ilçe) ortalama ilan-açık-kalma günü — region_stats_history'den.
   *  Verilirse "bölge hızına göre" karşılaştırması eklenir. */
  regionAvgDaysListed?: number | null;
};

const CRITICAL_PENALTY = 24;
const WARNING_PENALTY = 12;

/** İlan aktif pazarlamada mı (teşhis anlamlı mı). */
export function isDiagnosable(status: string): boolean {
  return status === "live" || status === "active";
}

export function diagnoseSaleBlockers(input: SaleDiagnosticsInput): SaleDiagnosis {
  const blockers: SaleBlocker[] = [];
  const positives: string[] = [];
  const isRent = input.transactionType === "rent" || input.transactionType === "kiralik";
  const kelime = isRent ? "kiralanamıyor" : "satılamıyor";

  // --- Fiyat: emsal bandı --------------------------------------------------
  const over = input.priceDeltaPct != null && input.priceDeltaPct > 0
    ? ` (emsalin ~%${Math.round(input.priceDeltaPct)} üzerinde)`
    : "";
  if (input.priceHealth === "red") {
    blockers.push({
      key: "price_red",
      severity: "critical",
      title: `Fiyat emsalin belirgin üzerinde${over}`,
      detail: "Aşırı fiyat, ilanı arama sonuçlarında ve alıcı kısa listesinde geri plana atar.",
      action: "Fiyatı emsal bandına çekin veya pazarlık payını netleştirin.",
    });
  } else if (input.priceHealth === "yellow") {
    blockers.push({
      key: "price_yellow",
      severity: "warning",
      title: `Fiyat emsal üstünde${over}`,
      detail: "Hafif yüksek fiyat, gösterim ve teklif hızını yavaşlatıyor olabilir.",
      action: "Emsal raporunu paylaşıp küçük bir güncelleme değerlendirin.",
    });
  } else if (input.priceHealth === "green") {
    positives.push("Fiyat emsal bandında — rekabetçi.");
  }

  // --- Portal görünürlüğü --------------------------------------------------
  if (input.livePortals === 0) {
    blockers.push({
      key: "no_portal",
      severity: "critical",
      title: "Hiçbir portalda yayında değil",
      detail: "Portal yayını olmadan ilan alıcı trafiğinin büyük kısmına ulaşmıyor.",
      action: "Portal Kontrol’den Sahibinden/Hepsiemlak yayınını açın.",
    });
  } else {
    positives.push(`${input.livePortals} portalda canlı yayında.`);
  }

  // --- Fotoğraf ------------------------------------------------------------
  if (input.mediaCount < 3) {
    blockers.push({
      key: "few_photos",
      severity: "critical",
      title: `Yetersiz fotoğraf (${input.mediaCount})`,
      detail: "Az görselli ilanlar belirgin biçimde daha az tıklama ve gösterim alır.",
      action: "En az 8 kaliteli fotoğraf ekleyin (giriş, salon, mutfak, cephe).",
    });
  } else if (input.mediaCount < 8) {
    blockers.push({
      key: "more_photos",
      severity: "warning",
      title: `Fotoğraf sayısı düşük (${input.mediaCount})`,
      detail: "8+ fotoğraflı ilanlar daha yüksek dönüşüm sağlıyor.",
      action: `${8 - input.mediaCount} fotoğraf daha ekleyerek kapağı güçlendirin.`,
    });
  } else {
    positives.push(`${input.mediaCount} fotoğraf — zengin galeri.`);
  }

  // --- Piyasada geçen süre -------------------------------------------------
  if (input.daysOnMarket >= 90) {
    blockers.push({
      key: "stale_90",
      severity: "warning",
      title: `${input.daysOnMarket} gündür piyasada`,
      detail: `Uzun süre ${kelime}; fiyat/sunum revizyonu genelde ivme kazandırır.`,
      action: "Fiyatı gözden geçirin, kapak fotoğrafını ve başlığı yenileyin.",
    });
  }

  // --- Görüntülenme hızı ---------------------------------------------------
  if (input.livePortals > 0 && input.daysOnMarket >= 14) {
    const perDay = input.totalViews / Math.max(1, input.daysOnMarket);
    if (perDay < 1) {
      blockers.push({
        key: "low_views",
        severity: "warning",
        title: "Görüntülenme düşük",
        detail: `Vitrinde günlük ~${perDay.toFixed(1)} görüntülenme; ilgi zayıf.`,
        action: "Başlık/kapak fotoğrafını güçlendirin, sosyal medyada paylaşın.",
      });
    }
    if (input.views7d === 0) {
      blockers.push({
        key: "no_recent_views",
        severity: "warning",
        title: "Son 7 günde hiç görüntülenme yok",
        detail: "İlan görünürlüğünü tamamen yitirmiş olabilir.",
        action: "İlanı öne çıkarın (doping) veya yeniden yayınlayın.",
      });
    }
  }
  if (input.views7d > 0) positives.push(`Son 7 günde ${input.views7d} görüntülenme.`);

  // --- Bölge hızı kıyası ---------------------------------------------------
  const region = input.regionAvgDaysListed;
  if (region != null && region > 0) {
    const r = Math.round(region);
    if (input.daysOnMarket >= 21 && input.daysOnMarket > region * 1.4) {
      blockers.push({
        key: "slower_than_region",
        severity: "warning",
        title: `Bölge hızının üstünde (${input.daysOnMarket}g / emsal ~${r}g)`,
        detail: `İlçedeki emsaller ortalama ~${r} günde el değiştiriyor; bu ilan belirgin biçimde geride.`,
        action: "Fiyat/sunumu emsal hızına göre revize edin; öne çıkarmayı değerlendirin.",
      });
    } else if (input.daysOnMarket > 0 && input.daysOnMarket <= region * 0.8) {
      positives.push(`Bölge hızının altında (emsal ~${r}g).`);
    }
  }

  // --- Skor & karar --------------------------------------------------------
  let score = 100;
  for (const b of blockers) {
    score -= b.severity === "critical" ? CRITICAL_PENALTY : WARNING_PENALTY;
  }
  score = Math.max(0, Math.min(100, score));

  // Kritik önce, sonra uyarı; grup içi eklenme sırası korunur.
  blockers.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  const verdict: SaleDiagnosis["verdict"] =
    score >= 75 ? "healthy" : score >= 45 ? "needs_attention" : "at_risk";

  return { verdict, score, blockers, positives };
}
