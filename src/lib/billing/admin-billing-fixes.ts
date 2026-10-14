import { DAY_MS, TR_OFFSET_MS, trDayStartMs } from "@/lib/clock";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { platformCan, platformCanAccess, type PlatformAccessSubject } from "@/lib/platform-access";

/**
 * Platform personelinin abonelik düzeltme kuralları (SAF; `app/actions/platform-trial.ts` ve
 * `app/actions/platform-subscription-fix.ts` aynı kaynağı kullanır, testli). Zaman çağırandan gelir (`now()`).
 */

/** Deneme bitişi en çok bugünden bu kadar gün ileri taşınabilir. */
export const TRIAL_MAX_AHEAD_DAYS = 90;
/** Dönemi bitmiş aboneliğin dönemi tek seferde en çok bu kadar gün uzatılır. */
export const PERIOD_EXTEND_MAX_DAYS = 90;
/** Gerekçe alt sınırı (denetim izi okunur olsun). */
export const FIX_REASON_MIN = 10;
/** Bu sayıdan SONRAKİ deneme değişikliğinde uyarı verilir (2. uzatmadan sonra). */
export const TRIAL_CHANGE_WARN_AFTER = 2;

export type TrialChangeInput = { days: number } | { date: string };
export type TrialChangeResult = { ok: true; endIso: string } | { ok: false; error: string };

/**
 * Deneme değiştirme yetkisi: "sales" ya da "tenants" modülü + yazma yetkisi
 * (satış modülünde YAZ yetkisi olan rol ya da ofis paket/durum yazma yetkisi olan rol). Modülü yalnız görüntüleyen
 * (salt okunur) özel rol deneme süresini değiştiremez.
 */
export function canChangeTrial(role: PlatformAccessSubject): boolean {
  const hasModule = platformCanAccess(role, "sales") || platformCanAccess(role, "tenants");
  const canWrite = platformCan(role, "sales", "write") || officeAdminCan(role, "plan_status");
  return hasModule && canWrite;
}

/** "YYYY-AA-GG" → o TR gününün SON saniyesi (23:59:59 TR) ms; geçersizse null. */
export function trDateEndMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = Date.UTC(y, mo - 1, d) - TR_OFFSET_MS;
  const check = new Date(start + TR_OFFSET_MS);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return start + DAY_MS - 1000;
}

/**
 * Yeni deneme bitişi. `{days}`: mevcut bitişe (geçmişte/boşsa bugüne) eklenir; negatif = kısalt.
 * `{date}`: o TR gününün sonu. Sınır: yeni bitiş ≥ YARIN (TR günü başı) ve ≤ bugün + 90 gün (TR günü sonu).
 */
export function resolveTrialEnd(input: TrialChangeInput, currentEndIso: string | null, nowMs: number): TrialChangeResult {
  let endMs: number;
  if ("days" in input) {
    const days = Number(input.days);
    if (!Number.isInteger(days) || days === 0 || Math.abs(days) > TRIAL_MAX_AHEAD_DAYS) {
      return { ok: false, error: `Gün sayısı -${TRIAL_MAX_AHEAD_DAYS} ile ${TRIAL_MAX_AHEAD_DAYS} arasında, sıfırdan farklı bir tam sayı olmalı.` };
    }
    const cur = currentEndIso ? Date.parse(currentEndIso) : Number.NaN;
    const base = Number.isFinite(cur) && cur > nowMs ? cur : nowMs;
    endMs = base + days * DAY_MS;
  } else {
    const parsed = trDateEndMs(input.date);
    if (parsed === null) return { ok: false, error: "Geçerli bir tarih seçin." };
    endMs = parsed;
  }
  const todayStart = trDayStartMs(nowMs);
  const minMs = todayStart + DAY_MS;
  const maxMs = todayStart + (TRIAL_MAX_AHEAD_DAYS + 1) * DAY_MS - 1000;
  if (endMs < minMs) return { ok: false, error: "Yeni deneme bitişi en erken yarın olabilir." };
  if (endMs > maxMs) return { ok: false, error: `Deneme bitişi bugünden en çok ${TRIAL_MAX_AHEAD_DAYS} gün sonrası olabilir.` };
  return { ok: true, endIso: new Date(endMs).toISOString() };
}

export type PeriodExtendResult = { ok: true; endIso: string } | { ok: false; error: string };

/** Dönemi bitmiş aboneliğin yeni dönem sonu: max(eski bitiş, şimdi) + N gün (1..90). */
export function extendPeriodEnd(currentEndIso: string | null, days: number, nowMs: number): PeriodExtendResult {
  if (!Number.isInteger(days) || days < 1 || days > PERIOD_EXTEND_MAX_DAYS) {
    return { ok: false, error: `Uzatma 1 ile ${PERIOD_EXTEND_MAX_DAYS} gün arasında olmalı.` };
  }
  const cur = currentEndIso ? Date.parse(currentEndIso) : Number.NaN;
  const base = Number.isFinite(cur) && cur > nowMs ? cur : nowMs;
  return { ok: true, endIso: new Date(base + days * DAY_MS).toISOString() };
}

/** Gerekçe: kırpılmış, en az 10 en çok 500 karakter; geçersizse null. */
export function cleanReason(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return v.length >= FIX_REASON_MIN ? v.slice(0, 500) : null;
}
