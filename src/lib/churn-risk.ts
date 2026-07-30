/**
 * Müşteri churn (kaybetme) riski. Isı segmenti "ne kadar sıcak"ı ölçer; churn
 * riski "kaybetmek üzere miyiz"i ölçer — kilit içgörü: risk, DEĞERLİ ama artık
 * SESSİZ müşteride yüksektir. Hiç etkileşime girmemiş soğuk kayıt "churn" etmez;
 * bir zamanlar ilgili olup şimdi soğuyan müşteri gerçek kayıp riskidir.
 *
 * Saf/deterministik; mevcut sinyallerden hesaplanır, şema değişikliği yok.
 */

export type ChurnSignals = {
  /** Son temastan bu yana gün (null = hiç temas yok). */
  daysSinceContact: number | null;
  /** Geçmiş etkileşim yoğunluğu 0..100 (lead skoru iyi bir vekildir). */
  engagementScore: number;
  /** Karşılanmamış açık talep sayısı — giderilmezse müşteri başka ofise gider. */
  openDemands: number;
  /** Gelecekte planlı randevu var mı — bir sonraki temas noktası = tutundurulmuş. */
  hasUpcomingAppointment: boolean;
  blacklist: boolean;
};

export type ChurnRisk = {
  risk: number; // 0..100
  tier: "high" | "medium" | "low" | "na";
  label: string;
  action: string; // önerilen tutundurma aksiyonu
};

/** Dormancy → temel risk eğrisi (0..1 çarpanı). */
function dormancyBase(days: number | null): number {
  if (days == null) return 0.15;
  if (days < 14) return 0.05;
  if (days < 30) return 0.3;
  if (days < 60) return 0.55;
  if (days < 120) return 0.8;
  return 1;
}

export function computeChurnRisk(s: ChurnSignals): ChurnRisk {
  if (s.blacklist) {
    return { risk: 0, tier: "na", label: "Uygulanmaz", action: "Kara listedeki müşteri için risk izlenmez." };
  }
  // Gelecekte randevu = güçlü tutundurma → riski belirgin düşür.
  if (s.hasUpcomingAppointment) {
    return { risk: 8, tier: "low", label: "Düşük risk", action: "Planlı randevu var — teyit et ve hazırlan." };
  }

  const base = dormancyBase(s.daysSinceContact);
  // Değer ağırlığı: yüksek geçmiş etkileşim, kaybı daha maliyetli kılar → risk skorunu yükseltir.
  const valueWeight = 0.55 + (Math.max(0, Math.min(100, s.engagementScore)) / 100) * 0.45; // 0.55..1.0
  let risk = base * valueWeight * 100;

  // Karşılanmamış açık talep → kaçış motivasyonu artar.
  risk += Math.min(12, s.openDemands * 6);

  risk = Math.max(0, Math.min(100, Math.round(risk)));
  const tier: ChurnRisk["tier"] = risk >= 60 ? "high" : risk >= 32 ? "medium" : "low";

  let action: string;
  if (tier === "high") {
    action = s.openDemands > 0
      ? "Bugün ara: açık talebine uygun 2–3 portföy gönder, ilişkiyi kurtar."
      : "Bugün ara veya kişisel bir mesaj at — ilişki kopmak üzere.";
  } else if (tier === "medium") {
    action = "Bu hafta bir dokunuş planla (yeni ilan, piyasa notu).";
  } else {
    action = "İlişki sağlıklı — rutin takibe devam.";
  }

  const label = tier === "high" ? "Yüksek risk" : tier === "medium" ? "Orta risk" : "Düşük risk";
  return { risk, tier, label, action };
}
