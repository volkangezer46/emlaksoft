import type { PillTone } from "@/components/ui/list-kit";

/** Anlaşma listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir; zaman dışarıdan verilir). */

export const DEAL_STAGE_KEYS = ["new", "qualified", "negotiation", "won", "lost"] as const;
export type DealStageKey = (typeof DEAL_STAGE_KEYS)[number];

/** Açık (kazanılmamış/kaybedilmemiş) aşamalar. */
export const OPEN_STAGES = ["new", "qualified", "negotiation"] as const;

/** Bayat açık anlaşma eşiği (gün): bu kadar süredir güncellenmeyen kartlar. */
export const STALE_DAYS = 14;

export function dealStageTone(stage: string): PillTone {
  switch (stage) {
    case "new":
      return "info";
    case "qualified":
      return "info";
    case "negotiation":
      return "warning";
    case "won":
      return "success";
    case "lost":
      return "danger";
    default:
      return "neutral";
  }
}

/** ?asama= değeri: aşama anahtarı ya da "acik" (kazanılmamış + kaybedilmemiş); aksi halde "". */
export function parseStageParam(value: string | undefined): string {
  if (value === "acik") return "acik";
  return (DEAL_STAGE_KEYS as readonly string[]).includes(value ?? "") ? (value as string) : "";
}

type SumRow = { stage: string; deal_value: number | null; probability: number | null };

export type DealSums = {
  openValue: number;
  /** Açık kartların değeri olasılıkla ağırlıklı (probability boşsa %20 varsayılan, tahtayla aynı kabul). */
  weighted: number;
  wonValue: number;
};

/** Tutar toplamları; tarama tavana dayandıysa (kesik olabilir) null → rakamlar gösterilmez. */
export function sumDeals(rows: readonly SumRow[], scanLimit: number): DealSums | null {
  if (rows.length >= scanLimit) return null;
  let openValue = 0;
  let weighted = 0;
  let wonValue = 0;
  for (const d of rows) {
    const v = d.deal_value ?? 0;
    if (d.stage === "won") wonValue += v;
    else if (d.stage !== "lost") {
      openValue += v;
      weighted += v * (Math.min(100, d.probability ?? 20) / 100);
    }
  }
  return { openValue, weighted: Math.round(weighted), wonValue };
}

/** Kazanma oranı: sonuçlananlar (kazanılan + kaybedilen) içinde; payda 0 ise null (uydurma yok). */
export function winRate(won: number, lost: number): number | null {
  return won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
}

/** Güncelleme yaşı etiketi (days: geçen tam gün). */
export function updatedAgoLabel(days: number): string {
  if (days <= 0) return "Bugün";
  if (days === 1) return "Dün";
  return `${days} gün önce`;
}
