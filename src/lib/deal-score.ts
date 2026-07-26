/**
 * Anlaşma kapanma olasılığı — sistem tahmini (X8).
 *
 * ============================================================================
 * NEDEN GEREKLİ
 * ============================================================================
 * `deals.probability` alanı yalnızca AŞAMADAN türetiliyordu:
 *
 *     new 20 · qualified 40 · negotiation 60 · won 100 · lost 0
 *
 * Yani aşamanın sayıya çevrilmiş hâliydi ve EK BİLGİ TAŞIMIYORDU. Kanban zaten
 * aşamayı gösteriyor; oranın altındaki çubuk aynı şeyi ikinci kez söylüyordu.
 *
 * 60 günlük, 40 gündür dokunulmamış, hiç teklif almamış bir "müzakere"
 * anlaşması ile dün teklif gelmiş bir "müzakere" anlaşması AYNI %60'ı
 * gösteriyordu.
 *
 * ============================================================================
 * KULLANICININ GİRDİSİ SİLİNMİYOR
 * ============================================================================
 * `probability` elle de düzenlenebiliyor (kanban düzenleme kutusu). Bu hesap
 * o alanın ÜZERİNE YAZMIYOR — yanında ayrı bir "sistem tahmini" olarak
 * duruyor. Asıl değer ikisinin FARKINDA: danışman %80 diyorsa ve sistem %35
 * diyorsa, sebebini görmek gerekir.
 *
 * ============================================================================
 * SINIR
 * ============================================================================
 * Bu bir kural tabanlı puanlama, istatistiksel bir model değil. Ağırlıklar
 * gözlemlenen satış davranışına göre seçildi; geçmiş veriden öğrenilmedi.
 * Her faktör gerekçesiyle döndürülüyor ki kullanıcı katılmadığında NEDENİNİ
 * görebilsin.
 */

export type DealSignals = {
  stage: string;
  /** Anlaşmanın açılış tarihi (ISO). */
  createdAt: string;
  /** Son güncelleme (ISO) — hareketsizlik ölçüsü. */
  updatedAt: string | null;
  /** Bu anlaşmaya bağlı teklif sayısı. */
  offerCount: number;
  /** Kabul edilmiş teklif var mı. */
  hasAcceptedOffer: boolean;
  /** Tamamlanmış yer gösterme / görüşme sayısı. */
  appointmentCount: number;
  /** Açık görev sayısı — takip ediliyor mu. */
  openTaskCount: number;
  /** Anlaşma tutarı ve portföy liste fiyatı (varsa). */
  dealValue?: number | null;
  listPrice?: number | null;
};

export type DealScore = {
  /** 0..100 */
  score: number;
  tier: "high" | "medium" | "low";
  label: string;
  factors: { label: string; points: number }[];
};

/** Aşama tabanı — hesabın çıkış noktası, tek belirleyicisi değil. */
const STAGE_BASE: Record<string, number> = {
  new: 15,
  qualified: 35,
  negotiation: 55,
  won: 100,
  lost: 0,
};

function gun(from: string, to: number): number | null {
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((to - t) / 86_400_000);
}

export function computeDealScore(s: DealSignals, now: number = Date.now()): DealScore {
  // Kapanmış anlaşmada tahmin anlamsız: sonuç zaten belli.
  if (s.stage === "won") {
    return { score: 100, tier: "high", label: "Kazanıldı", factors: [{ label: "Kapandı", points: 100 }] };
  }
  if (s.stage === "lost") {
    return { score: 0, tier: "low", label: "Kaybedildi", factors: [{ label: "Kapandı", points: 0 }] };
  }

  const factors: { label: string; points: number }[] = [];
  const taban = STAGE_BASE[s.stage] ?? 15;
  let puan = taban;
  factors.push({ label: "Aşama", points: taban });

  // --- Teklif: en güçlü niyet sinyali ---
  if (s.hasAcceptedOffer) {
    puan += 25;
    factors.push({ label: "Kabul edilmiş teklif", points: 25 });
  } else if (s.offerCount > 0) {
    // Birden çok teklif pazarlık demek; ikinciden sonrası ek bilgi vermiyor.
    const p = Math.min(15, 8 + (s.offerCount - 1) * 4);
    puan += p;
    factors.push({ label: `${s.offerCount} teklif`, points: p });
  }

  // --- Yüz yüze temas ---
  if (s.appointmentCount > 0) {
    const p = Math.min(12, s.appointmentCount * 6);
    puan += p;
    factors.push({ label: `${s.appointmentCount} görüşme`, points: p });
  }

  // --- Takip ediliyor mu ---
  if (s.openTaskCount > 0) {
    puan += 5;
    factors.push({ label: "Açık takip görevi", points: 5 });
  }

  /*
   * HAREKETSİZLİK — en ayırt edici sinyal.
   * Aynı aşamada duran iki anlaşmayı burası ayırır. Dokunulmayan bir anlaşma
   * ilerlemiyor demektir; ceza kademeli çünkü 10 gün sessizlik normal,
   * 60 gün değil.
   */
  const sessiz = gun(s.updatedAt ?? s.createdAt, now);
  if (sessiz !== null) {
    let ceza = 0;
    if (sessiz > 60) ceza = -30;
    else if (sessiz > 30) ceza = -18;
    else if (sessiz > 14) ceza = -8;
    if (ceza !== 0) {
      puan += ceza;
      factors.push({ label: `${sessiz} gündür hareket yok`, points: ceza });
    }
  }

  /*
   * YAŞ — hareketsizlikten AYRI bir sinyal. Sürekli dokunulan ama aylardır
   * kapanmayan bir anlaşma da sorunludur.
   */
  const yas = gun(s.createdAt, now);
  if (yas !== null && yas > 90) {
    puan -= 10;
    factors.push({ label: `${yas} gündür açık`, points: -10 });
  }

  /*
   * FİYAT AÇIĞI — anlaşma tutarı liste fiyatının belirgin altındaysa taraflar
   * henüz aynı noktada değil demektir.
   */
  if (s.dealValue != null && s.listPrice != null && s.listPrice > 0 && s.dealValue > 0) {
    const fark = ((s.listPrice - s.dealValue) / s.listPrice) * 100;
    if (fark > 15) {
      puan -= 12;
      factors.push({ label: `Liste fiyatının %${Math.round(fark)} altında`, points: -12 });
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(puan)));
  const tier: DealScore["tier"] = score >= 65 ? "high" : score >= 35 ? "medium" : "low";
  const label = tier === "high" ? "Yüksek" : tier === "medium" ? "Orta" : "Düşük";
  return { score, tier, label, factors };
}

/**
 * Kullanıcının girdiği oran ile sistem tahmini arasındaki anlamlı fark.
 * 20 puan altındaki sapma gürültü sayılıyor — uyarı vermek dikkat dağıtır.
 */
export function scoreGap(userProbability: number | null | undefined, systemScore: number): number | null {
  if (userProbability == null || !Number.isFinite(userProbability)) return null;
  const fark = Math.round(userProbability - systemScore);
  return Math.abs(fark) >= 20 ? fark : null;
}
