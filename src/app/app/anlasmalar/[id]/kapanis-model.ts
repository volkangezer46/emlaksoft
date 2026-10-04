/**
 * Anlaşma kapanış sihirbazı — saf mantık (IO yok). Komisyon hesabı `lib/commission.ts`,
 * aşama geçişi `updateDealStage`, paylar `updateCommissionSplits` ve kayıp nedeni doğrulaması
 * `lib/loss-reason.ts` içinde kalır; burada yalnız adım akışı ve form yardımcıları vardır.
 */
import { LOSS_NOTE_MAX, LOSS_NOTE_SEPARATOR } from "@/lib/loss-reason";

/** Vade adımında açılan tahsilat görevinin başlık öneki (yeniden açıldığında "yapıldı" tespiti için). */
export const COLLECTION_TASK_PREFIX = "Komisyon tahsilatı";

export type ClosingOutcome ="won" | "lost";
export type WonStep = "tutar" | "onay" | "paylar" | "vade" | "belgeler" | "anket" | "bitis";
export type LostStep = "neden" | "takip" | "bitis";
export type ClosingStep = WonStep | LostStep;

export const WON_STEPS: readonly { id: WonStep; label: string }[] = [
  { id: "tutar", label: "Tutar" },
  { id: "onay", label: "Kazanıldı" },
  { id: "paylar", label: "Paylar" },
  { id: "vade", label: "Vade" },
  { id: "belgeler", label: "Belgeler" },
  { id: "anket", label: "Anket" },
  { id: "bitis", label: "Bitiş" },
];

export const LOST_STEPS: readonly { id: LostStep; label: string }[] = [
  { id: "neden", label: "Neden" },
  { id: "takip", label: "Takip" },
  { id: "bitis", label: "Bitiş" },
];

export function stepsFor(outcome: ClosingOutcome) {
  return outcome === "won" ? WON_STEPS : LOST_STEPS;
}

/** Aşamaya göre sihirbazın başlangıç sonucu: açık anlaşmada seçim ekranı (null). */
export function outcomeForStage(stage: string): ClosingOutcome | null {
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return null;
}

/**
 * Pano ve "Geçiş" menüsü kapanışı popup ile değil bu sekmeyle yapar: `?sekme=kapanis&sonuc=<değer>`.
 * `sonuc` yalnız sihirbazın hangi akışla açılacağını seçer; aşama, sihirbazda onaylanınca değişir.
 */
export const OUTCOME_PARAM: Readonly<Record<ClosingOutcome, string>> = { won: "kazanildi", lost: "kaybedildi" };

export function closingTabHref(dealId: string, outcome: ClosingOutcome): string {
  return `/app/anlasmalar/${dealId}?sekme=kapanis&sonuc=${OUTCOME_PARAM[outcome]}`;
}

/** URL'deki `sonuc` değerini sihirbaz sonucuna çevirir; boş veya tanınmayan değer null. */
export function parseOutcomeParam(raw: string | string[] | null | undefined): ClosingOutcome | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === OUTCOME_PARAM.won) return "won";
  if (value === OUTCOME_PARAM.lost) return "lost";
  return null;
}

/**
 * Sihirbazın açılış sonucu. Kapanmış anlaşmada aşama belirler (URL'deki istek yok sayılır);
 * açık anlaşmada URL'den gelen istek ön seçilir, istek yoksa seçim ekranı (null) açılır.
 */
export function initialOutcome(stage: string, requested: ClosingOutcome | null | undefined): ClosingOutcome | null {
  return outcomeForStage(stage) ?? requested ?? null;
}

/** Kazanılmış anlaşmada ilk adım "paylar"; kapanmamışta ilk adım; kayıpta özet/takip. */
export function initialStep(outcome: ClosingOutcome | null, stage: string): ClosingStep {
  if (outcome === "won") return stage === "won" ? "paylar" : "tutar";
  if (outcome === "lost") return stage === "lost" ? "takip" : "neden";
  return "tutar";
}

/** Kazanıldı işaretinden ÖNCE yalnız ilk iki adım açıktır. */
export function isStepUnlocked(outcome: ClosingOutcome, step: ClosingStep, stage: string): boolean {
  if (outcome === "lost") return step === "neden" || stage === "lost";
  if (step === "tutar" || step === "onay") return true;
  return stage === "won";
}

export type ReadinessInput = {
  dealType: string;
  hasProperty: boolean;
  hasCustomer: boolean;
  dealValue: number | null;
  commissionRate: number | null;
};

export type ReadinessItem = { key: string; label: string; ok: boolean; href?: string };

/** `transition_deal_stage_atomic` kazanma ön koşullarının arayüz aynası (nihai karar yine sunucudadır). */
export function wonReadiness(i: ReadinessInput, ids: { dealId: string; propertyId: string | null }): ReadinessItem[] {
  return [
    { key: "property", label: "Anlaşmaya portföy bağlı", ok: i.hasProperty },
    { key: "customer", label: "Anlaşmaya müşteri bağlı", ok: i.hasCustomer },
    { key: "value", label: "Nihai anlaşma tutarı girildi", ok: (i.dealValue ?? 0) > 0 },
    {
      key: "rate",
      label: "Portföyde komisyon oranı tanımlı",
      ok: i.commissionRate != null && i.commissionRate > 0 && i.commissionRate <= 100,
      href: ids.propertyId ? `/app/portfoyler/${ids.propertyId}` : undefined,
    },
    { key: "type", label: "Satış anlaşması (kiralama kapanışı Kiralama ekranından yapılır)", ok: i.dealType !== "rent", href: i.dealType === "rent" ? "/app/kiralama" : undefined },
  ];
}

export function isReadyToWin(items: ReadinessItem[]): boolean {
  return items.every((x) => x.ok);
}

/** Rakip ve fiyat notunu tek `loss_note` alanına birleştirir (kayıt biçimi: "<neden> | <not>"). */
export function buildLossNote(competitor: string, price: string, extra = ""): string {
  const parts = [
    competitor.trim() ? `Rakip: ${competitor.trim()}` : "",
    price.trim() ? `Fiyat: ${price.trim()}` : "",
    extra.trim(),
  ].filter(Boolean);
  return parts.join(" · ").split(LOSS_NOTE_SEPARATOR).join(" / ").slice(0, LOSS_NOTE_MAX);
}

export type SplitRow = { label: string; rate: string };

export function splitsTotal(rows: readonly SplitRow[]): number {
  return Math.round(rows.reduce((s, r) => s + (Number(r.rate) || 0), 0) * 100) / 100;
}

export function splitsError(rows: readonly SplitRow[]): string | null {
  const valid = rows.filter((r) => r.label.trim() && Number(r.rate) > 0);
  if (valid.length === 0) return "En az bir paylaşım satırı girin.";
  const total = splitsTotal(valid);
  if (total > 100.01) return `Toplam oran %100'ü aşamaz (şu an %${total}).`;
  return null;
}

/** Danışman payını (ilk "Danışman" satırı) kaydedilmiş paylardan bulur. */
export function advisorShareOf(rows: readonly { label?: string; rate?: number }[] | null | undefined): number | null {
  const row = rows?.find((r) => (r.label ?? "").toLowerCase().startsWith("danışman") || (r.label ?? "").toLowerCase().startsWith("danisman"));
  return row && typeof row.rate === "number" ? row.rate : null;
}
