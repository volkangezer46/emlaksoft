/**
 * Yetki süresi kuralları (SAF). EİDS'te mal sahibinin verdiği yetki en az 3 ay olmalıdır; bu yüzden
 * "çok kısa yetki" ayrı bir uyarıdır. Bitişe yaklaşma pencereleri 15/7/3 gündür (`license.ts` 60/30/7 kalıbından ayrı:
 * o ofis yetki BELGESİNİ, bu portföy yetkisini izler). Tarihler `YYYY-MM-DD` (date kolonu); "bugün" Türkiye gününe göredir.
 */
import { DAY_MS, trDayKey } from "@/lib/clock";

export const MIN_AUTHORITY_MONTHS = 3;
export const EXPIRING_WINDOW_DAYS = 15;
export const AUTHORITY_URGENCY_DAYS = { critical: 3, warning: 7, soon: 15 } as const;

export type AuthorityState = "missing" | "expired" | "expiring" | "ok";
export type AuthorityUrgency = "critical" | "warning" | "soon" | null;

export type AuthorityTerm = {
  state: AuthorityState;
  /** Bitişe kalan tam gün (bugün = 0); bitiş yoksa null. */
  daysLeft: number | null;
  urgency: AuthorityUrgency;
  /** Başlangıç ve bitiş var, bitiş başlangıçtan en az 3 ay sonra DEĞİL. */
  short: boolean;
  /** Başlangıç-bitiş arası gün; ikisi de yoksa null. */
  termDays: number | null;
  /** Kullanıcıya gösterilecek tek cümlelik Türkçe uyarı (sorun yoksa null). */
  message: string | null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function dayNumber(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

/** Başlangıca takvim ayı ekler (ay sonu taşmasında ayın son gününe sabitler). */
export function addMonthsDay(startDay: number, months: number): number {
  const d = new Date(startDay * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(y, m, Math.min(day, lastDay)) / DAY_MS);
}

export function evaluateAuthorityTerm(
  input: { start: string | null | undefined; end: string | null | undefined },
  nowMs: number,
): AuthorityTerm {
  const startDay = dayNumber(input.start);
  const endDay = dayNumber(input.end);
  const today = dayNumber(trDayKey(nowMs)) as number;

  const short = startDay !== null && endDay !== null && endDay < addMonthsDay(startDay, MIN_AUTHORITY_MONTHS);
  const termDays = startDay !== null && endDay !== null ? endDay - startDay : null;

  if (endDay === null) {
    return { state: "missing", daysLeft: null, urgency: null, short: false, termDays, message: "Yetki bitiş tarihi girilmemiş." };
  }
  const daysLeft = endDay - today;
  if (daysLeft < 0) {
    return { state: "expired", daysLeft, urgency: null, short, termDays, message: "Yetki süresi dolmuş; yenilenmeden ilan yayında kalamaz." };
  }
  if (daysLeft <= EXPIRING_WINDOW_DAYS) {
    const urgency: AuthorityUrgency =
      daysLeft <= AUTHORITY_URGENCY_DAYS.critical ? "critical" : daysLeft <= AUTHORITY_URGENCY_DAYS.warning ? "warning" : "soon";
    return {
      state: "expiring",
      daysLeft,
      urgency,
      short,
      termDays,
      message: daysLeft === 0 ? "Yetki bugün bitiyor." : `Yetki ${daysLeft} gün içinde bitiyor; mal sahibinin EİDS'te uzatması gerekir.`,
    };
  }
  return {
    state: "ok",
    daysLeft,
    urgency: null,
    short,
    termDays,
    message: short ? `Yetki süresi ${MIN_AUTHORITY_MONTHS} aydan kısa; EİDS yetki en az ${MIN_AUTHORITY_MONTHS} ay olmalıdır.` : null,
  };
}

/** Yetki süresi kuralı ihlali (kaydı engellemez, uyarır): başlangıç/bitiş girildi ama < 3 ay. */
export function shortAuthorityWarning(start: string | null | undefined, end: string | null | undefined, nowMs: number): string | null {
  const t = evaluateAuthorityTerm({ start, end }, nowMs);
  if (!t.short) return null;
  return `Yetki süresi ${MIN_AUTHORITY_MONTHS} aydan kısa görünüyor; EİDS yetki en az ${MIN_AUTHORITY_MONTHS} ay olmalıdır. Kayıt yapıldı, tarihleri kontrol edin.`;
}
