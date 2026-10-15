import { OPEN_DEAL_STAGES } from "@/lib/workflow-state";
import type { PillTone } from "@/components/ui/list-kit";

/** Anlaşma listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir; zaman dışarıdan verilir). */

export const DEAL_STAGE_KEYS = ["new", "qualified", "negotiation", "won", "lost"] as const;
export type DealStageKey = (typeof DEAL_STAGE_KEYS)[number];

/** Açık (kazanılmamış/kaybedilmemiş) aşamalar. */
export const OPEN_STAGES = OPEN_DEAL_STAGES;

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

/* ---------------------------------------------------------------------------------------------- */
/* SP1: aşamada geçen gün + aşamaya özel bayatlık                                                  */
/* ---------------------------------------------------------------------------------------------- */

export type OpenStageKey = "new" | "qualified" | "negotiation";
export const OPEN_STAGE_KEYS: readonly OpenStageKey[] = ["new", "qualified", "negotiation"];
export type StageStaleDays = Record<OpenStageKey, number>;

/** Ofis Tanımları: aşamaya özel eşik ayarı (0 / boş = genel eşik `office.alert.deal_stale_days`). */
export const STAGE_STALE_SETTING_KEYS: Record<OpenStageKey, string> = {
  new: "office.alert.deal_stale_days_new",
  qualified: "office.alert.deal_stale_days_qualified",
  negotiation: "office.alert.deal_stale_days_negotiation",
};

/** Aşama başına bayatlık eşiği: aşama ayarı > 0 ise o, değilse genel eşik. */
export function stageStaleDays(general: number, overrides: Partial<Record<OpenStageKey, unknown>>): StageStaleDays {
  const g = Number.isFinite(general) && general > 0 ? Math.round(general) : STALE_DAYS;
  const pick = (k: OpenStageKey) => {
    const v = Number(overrides[k]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : g;
  };
  return { new: pick("new"), qualified: pick("qualified"), negotiation: pick("negotiation") };
}

export function isOpenStageKey(stage: string): stage is OpenStageKey {
  return (OPEN_STAGE_KEYS as readonly string[]).includes(stage);
}

/** Kart tonu: eşiğe ulaştıysa "warn", iki katını geçtiyse "late"; kapanmış aşamada her zaman "ok". */
export function stageAgeTone(stage: string, days: number, thresholds: StageStaleDays): "ok" | "warn" | "late" {
  if (!isOpenStageKey(stage)) return "ok";
  const t = thresholds[stage];
  if (days >= t * 2) return "late";
  if (days >= t) return "warn";
  return "ok";
}

/** "Bu aşamada 5 gün" (0 → "Bu aşamaya bugün geçti"). */
export function daysInStageLabel(days: number): string {
  if (days <= 0) return "Bu aşamaya bugün geçti";
  return `Bu aşamada ${days} gün`;
}

/**
 * Bayat açık anlaşma süzgeci (PostgREST `or` ifadesi): her açık aşama kendi eşiğinden eski `stage_changed_at` ile.
 * `cutoffIso(days)` çağırandan gelir (saat okuma bileşen dışında). Kapanmış aşamalar hiç eşleşmez.
 */
export function staleOrClause(thresholds: StageStaleDays, cutoffIso: (days: number) => string): string {
  return OPEN_STAGE_KEYS.map((k) => `and(stage.eq.${k},stage_changed_at.lt.${cutoffIso(thresholds[k])})`).join(",");
}

/** Eşiklerin hepsi aynıysa tek sayı (etiket için), değilse null. */
export function uniformStaleDays(t: StageStaleDays): number | null {
  return t.new === t.qualified && t.qualified === t.negotiation ? t.new : null;
}
