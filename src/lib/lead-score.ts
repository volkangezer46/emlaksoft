/**
 * Lead (aday müşteri) skorlama — 0..100.
 * Mevcut CRM sinyallerinden anlık hesaplanır; şema değişikliği gerektirmez.
 * Amaç: danışmanın en sıcak adaylara öncelik vermesi (Follow Up Boss / kvCORE mantığı).
 */

export type LeadSignals = {
  hasPhone: boolean;
  hasEmail: boolean;
  source: string | null;
  activeDemands: number;   // açık talep sayısı
  communications: number;  // iletişim kaydı sayısı
  appointments: number;    // randevu sayısı
  calls: number;           // çağrı sayısı
  lastActivityAt: string | null; // en son etkileşim (ISO)
  createdAt: string;       // müşteri kaydı (ISO)
  blacklist: boolean;
};

export type LeadScore = {
  score: number;          // 0..100
  tier: "hot" | "warm" | "cold";
  label: string;          // "Sıcak" | "Ilık" | "Soğuk"
  factors: { label: string; points: number }[];
};

const SOURCE_WEIGHT: Record<string, number> = {
  referral: 18,
  portal: 15,
  web: 12,
  phone: 12,
  social: 10,
  walk_in: 10,
  other: 6,
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function computeLeadScore(s: LeadSignals): LeadScore {
  if (s.blacklist) {
    return { score: 0, tier: "cold", label: "Soğuk", factors: [{ label: "Kara liste", points: 0 }] };
  }

  const factors: { label: string; points: number }[] = [];
  let score = 0;

  // İletişilebilirlik
  if (s.hasPhone) { score += 12; factors.push({ label: "Telefon var", points: 12 }); }
  if (s.hasEmail) { score += 6; factors.push({ label: "E-posta var", points: 6 }); }

  // Kaynak kalitesi
  const sw = SOURCE_WEIGHT[(s.source ?? "other").toLowerCase()] ?? 6;
  score += sw;
  factors.push({ label: "Kaynak kalitesi", points: sw });

  // Talep ilgisi (açık talep = niyet)
  const demandPts = Math.min(20, s.activeDemands * 10);
  if (demandPts > 0) { score += demandPts; factors.push({ label: "Açık talep", points: demandPts }); }

  // Etkileşim yoğunluğu
  const engagement = Math.min(20, s.communications * 3 + s.calls * 2);
  if (engagement > 0) { score += engagement; factors.push({ label: "İletişim yoğunluğu", points: engagement }); }

  // Randevu = yüksek niyet
  const apptPts = Math.min(18, s.appointments * 9);
  if (apptPts > 0) { score += apptPts; factors.push({ label: "Randevu", points: apptPts }); }

  // Güncellik (son etkileşim yakınsa sıcak, eskiyse soğur)
  const d = daysSince(s.lastActivityAt ?? s.createdAt);
  if (d !== null) {
    let recencyPts = 0;
    if (d <= 3) recencyPts = 14;
    else if (d <= 7) recencyPts = 10;
    else if (d <= 30) recencyPts = 5;
    else if (d <= 90) recencyPts = 0;
    else recencyPts = -8; // 3 aydan eski → soğuma
    score += recencyPts;
    factors.push({ label: "Güncellik", points: recencyPts });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier: LeadScore["tier"] = score >= 65 ? "hot" : score >= 35 ? "warm" : "cold";
  const label = tier === "hot" ? "Sıcak" : tier === "warm" ? "Ilık" : "Soğuk";
  return { score, tier, label, factors };
}

export function leadTierCls(tier: LeadScore["tier"]): string {
  if (tier === "hot") return "bg-rose-500/12 text-rose-600 ring-rose-500/25";
  if (tier === "warm") return "bg-amber-400/15 text-amber-600 ring-amber-500/25";
  return "bg-slate-400/12 text-slate-500 ring-slate-400/20";
}
