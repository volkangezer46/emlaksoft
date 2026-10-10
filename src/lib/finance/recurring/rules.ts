import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { addMonthsKey, RECURRENCE_LABEL, RECURRENCE_MONTHS, isRecurrence, type Recurrence } from "@/lib/finance/recurring-expenses";
import { isCashCategory, expenseCategoryFor, SALARY_CATEGORY, type CashDirection } from "@/lib/finance/cash/categories";
import { isUuid } from "@/lib/finance/cash/input";
import { PORTAL_KEYS, type PortalKey } from "@/lib/finance/portal-roi";

/**
 * Düzenli ödeme / gelir kuralları (SAF): tarih hesabı (SQL `recurring_due_date` ile aynı ay sonu kuralı) ve form doğrulaması.
 * Nihai kural RPC'dedir (migration 20261010000900); burası kullanıcıya erken, anlaşılır hata verir.
 */
export { RECURRENCE_LABEL, RECURRENCE_MONTHS };
export const RULE_MODES = ["auto", "approve"] as const;
export type RuleMode = (typeof RULE_MODES)[number];
export const RULE_MODE_LABEL: Record<RuleMode, string> = { auto: "Otomatik kaydet", approve: "Bana sor" };

const MAX = 9_999_999_999.99;

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` -> ayın ilk günü. */
export function monthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

/** Dönemin ödeme günü; 31 (ve kısa ayda büyük gün) ayın son gününe sıkışır. */
export function dueDateOf(periodKey: string, payDay: number): string {
  const y = Number(periodKey.slice(0, 4));
  const m = Number(periodKey.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(Math.max(payDay, 1), last))}`;
}

/** Sunucudaki `recurring_period_on_or_after` ile aynı: anchor ayından adımlarla, ödeme günü `from`a eşit/sonra olan ilk dönem. */
export function periodOnOrAfter(anchorKey: string, payDay: number, frequency: Recurrence, fromKey: string): string {
  let period = monthStartKey(anchorKey);
  for (let i = 0; i < 1500 && dueDateOf(period, payDay) < fromKey; i += 1) period = addMonthsKey(period, RECURRENCE_MONTHS[frequency]);
  return period;
}

/** Bir sonraki ödeme tarihi (liste için). */
export function nextDueOf(anchorKey: string, payDay: number, frequency: Recurrence, fromKey: string): string {
  return dueDateOf(periodOnOrAfter(anchorKey, payDay, frequency, fromKey), payDay);
}

export function payDayLabel(payDay: number): string {
  return payDay >= 31 ? "Ayın son günü" : `Her ayın ${payDay}. günü`;
}

/** "Her ay tekrarla" anahtarı: kayıt bugün girildi; kural gelecek aydan başlar (çift kayıt olmaz). */
export function nextMonthStartKey(todayKey: string): string {
  return addMonthsKey(monthStartKey(todayKey), 1);
}

export type ParsedRule = {
  scope: "office" | "user";
  direction: CashDirection;
  category: string;
  title: string;
  amount: number;
  accountId: string;
  frequency: Recurrence;
  payDay: number;
  startDate: string;
  endDate: string | null;
  mode: RuleMode;
  portalKey: PortalKey | null;
  expenseCategory: string | null;
};

type Raw = Record<string, FormDataEntryValue | string | number | null | undefined>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export type RuleParse = { ok: true; value: ParsedRule } | { ok: false; error: string };

/**
 * Form girdisi. `startMonth` (YYYY-MM, yalnız 3 aylık/yıllıkta) ilk ödeme ayını seçer; verilmezse bugün. Başlangıç hiçbir zaman
 * bugünden önce olmaz (geçmişe dönük kayıt yok).
 */
export function parseRuleInput(raw: Raw, scope: "office" | "user", today: string): RuleParse {
  const direction: CashDirection = str(raw.direction) === "in" ? "in" : "out";
  const category = str(raw.category);
  if (!isCashCategory(category, direction)) return { ok: false, error: "Ne için olduğunu seçin." };
  if (category === SALARY_CATEGORY && scope !== "office") return { ok: false, error: "Maaş yalnız ofis hesabından tanımlanır." };
  const accountId = str(raw.accountId);
  if (!isUuid(accountId)) return { ok: false, error: "Hangi hesap olduğunu seçin." };
  const amount = parseMoneyInput(raw.amount as string | number | null | undefined, { max: MAX });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { ok: false, error: "Geçerli, en çok iki ondalık haneli bir tutar girin." };
  const title = str(raw.title) || (category === "portal" && isPortal(str(raw.portalKey)) ? "Portal üyeliği" : "") || categoryTitle(category);
  if (title.length > 160) return { ok: false, error: "Açıklama en fazla 160 karakter olabilir." };
  const frequency = str(raw.frequency) || "monthly";
  if (!isRecurrence(frequency)) return { ok: false, error: "Sıklığı seçin." };
  const payDay = Math.trunc(Number(str(raw.payDay) || "1"));
  if (!Number.isFinite(payDay) || payDay < 1 || payDay > 31) return { ok: false, error: "Ödeme günü 1 ile 31 arasında olmalı (31 = ayın son günü)." };
  const mode = str(raw.mode) === "approve" ? "approve" : "auto";

  let startDate = str(raw.startDate) || today;
  const startMonth = str(raw.startMonth);
  if (!str(raw.startDate) && /^\d{4}-\d{2}$/.test(startMonth)) startDate = `${startMonth}-01` < today ? today : `${startMonth}-01`;
  if (!isIsoDate(startDate) || startDate < today) return { ok: false, error: "Başlangıç bugünden önce olamaz; geçmişe dönük kayıt açılmaz." };
  const endRaw = str(raw.endDate);
  if (endRaw && (!isIsoDate(endRaw) || endRaw < startDate)) return { ok: false, error: "Bitiş tarihi başlangıçtan önce olamaz." };

  const portalRaw = str(raw.portalKey);
  const portalKey = isPortal(portalRaw) ? portalRaw : null;
  return {
    ok: true,
    value: {
      scope,
      direction,
      category,
      title,
      amount: amount.value,
      accountId,
      frequency,
      payDay,
      startDate,
      endDate: endRaw || null,
      mode,
      portalKey: category === "portal" ? portalKey : null,
      expenseCategory: direction === "out" ? expenseCategoryFor(category) : null,
    },
  };
}

function isPortal(v: string): v is PortalKey {
  return (PORTAL_KEYS as readonly string[]).includes(v);
}

function categoryTitle(category: string): string {
  const labels: Record<string, string> = { kira: "Ofis kirası", muhasebe: "Muhasebe ücreti", sgk: "SGK", maas: "Maaşlar", portal: "Portal üyeliği", aidat: "Aidat" };
  return labels[category] ?? "Düzenli ödeme";
}

export { RECURRENCE_LABEL as FREQUENCY_LABEL };

/** RPC `outcome` kodlarının Türkçe karşılığı (düzenli ödemeler). */
export function recurringOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "unauthorized": return "Oturum bulunamadı. Yeniden giriş yapın.";
    case "forbidden": return "Bu işlem için yetkiniz yok.";
    case "invalid_input": return "Girdiğiniz bilgileri kontrol edin (tutar, gün ve başlangıç tarihi).";
    case "not_found": return "Kayıt bulunamadı.";
    case "archived": return "Hesap arşivde; başka bir hesap seçin.";
    case "limit_reached": return "En fazla 100 etkin düzenli ödeme tanımlanabilir.";
    case "has_history": return "Bu ödemeden hareket üretilmiş; silinemez, durdurabilirsiniz.";
    case "already_decided": return "Bu ödeme için karar zaten verilmiş.";
    case "before_opening": return "Ödeme tarihi hesabın açılış tarihinden önce.";
    case "ended": return "Bitiş tarihi geçtiği için sürdürülemez; bitiş tarihini değiştirin.";
    case "duplicate": return "Bu gider serisi zaten kurala çevrilmiş.";
    default: return "İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.";
  }
}
