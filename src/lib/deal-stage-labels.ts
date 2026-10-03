/**
 * Anlaşma aşaması GÖRÜNEN ad/renk çözümleme (saf, client/server ortak).
 *
 * Aşama anahtarları (DEAL_STAGES: new/qualified/negotiation/won/lost) RPC, otomasyon ve
 * rapor mantığına bağlıdır ve DEĞİŞMEZ; ofis yalnız etiketi ve rengi değiştirir
 * (definitions kategorisi `deal_stage_label`, value = aşama anahtarı).
 * Aşama adı basan her yer bu çözümlemeyi kullanır; yeni aşama eklenemez.
 */
import { DEAL_STAGES, type DealStage } from "@/lib/workflow-state";
import { defaultLabelMap } from "@/lib/definition-defaults";

export type StageLabel = { label: string; color: string | null };
export type StageLabels = Record<DealStage, StageLabel>;

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Varsayılan adlar (tek kaynak: definition-defaults.ts), renk yok. */
export function defaultStageLabels(): StageLabels {
  const base = defaultLabelMap("deal_stage_label");
  return Object.fromEntries(DEAL_STAGES.map((s) => [s, { label: base[s] ?? s, color: null }])) as StageLabels;
}

/** Ofis tanımlarını varsayılanların üstüne bindirir; bilinmeyen anahtar/boş etiket/bozuk renk yok sayılır. */
export function resolveStageLabels(items: { value: string; label: string; color: string | null }[] | null | undefined): StageLabels {
  const out = defaultStageLabels();
  for (const it of items ?? []) {
    if (!(DEAL_STAGES as readonly string[]).includes(it.value)) continue;
    const label = it.label?.trim();
    out[it.value as DealStage] = {
      label: label ? label : out[it.value as DealStage].label,
      color: it.color && COLOR_RE.test(it.color) ? it.color : null,
    };
  }
  return out;
}

/** Düz ad haritası (aşama anahtarı → görünen ad); bilinmeyen anahtar için `stageName` ham değeri döndürür. */
export function stageLabelMap(labels: StageLabels): Record<string, string> {
  return Object.fromEntries(DEAL_STAGES.map((s) => [s, labels[s].label]));
}

export function stageName(labels: StageLabels, stage: string): string {
  return (labels as Record<string, StageLabel | undefined>)[stage]?.label ?? stage;
}
