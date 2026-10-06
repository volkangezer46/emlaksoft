/**
 * Davet panosu huni hesabı (saf). Aşamalar: bağlantı tıklaması → kayıt → deneme (iptal olmayan) →
 * ödedi (bekleme + ödül) → ödül yüklendi. İptal/iade huninin DIŞINDA ayrı not olarak verilir.
 * `ardisik`: her aşama öncekinden büyük değilse true; aksi halde (ör. bağlantısız doğrudan kayıt)
 * dönüşüm oku gösterilmez, yanıltıcı oran üretilmez.
 */
export type InviteFunnelInput = { clicks: number; signups: number; trial: number; waiting: number; paid: number; cancelled: number };

export type InviteFunnelStage = { key: "click" | "signup" | "trial" | "paid" | "reward"; value: number };

export function inviteFunnel(d: InviteFunnelInput): { stages: InviteFunnelStage[]; ardisik: boolean; cancelled: number } {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const stages: InviteFunnelStage[] = [
    { key: "click", value: n(d.clicks) },
    { key: "signup", value: n(d.signups) },
    { key: "trial", value: n(d.trial) + n(d.waiting) + n(d.paid) },
    { key: "paid", value: n(d.waiting) + n(d.paid) },
    { key: "reward", value: n(d.paid) },
  ];
  const ardisik = stages.every((s, i) => i === 0 || s.value <= stages[i - 1]!.value);
  return { stages, ardisik, cancelled: n(d.cancelled) };
}

/** Aşama oranı (%): önceki aşama 0 ise null. */
export function stageRates(stages: readonly InviteFunnelStage[]): (number | null)[] {
  return stages.map((s, i) => (i === 0 ? null : stages[i - 1]!.value > 0 ? Math.round((s.value / stages[i - 1]!.value) * 100) : null));
}
