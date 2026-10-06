import { trDayKey, trMonthKey, trDayStartMs, DAY_MS, trParts } from "@/lib/clock";
import type { InsightDraft } from "@/lib/insights/types";

/**
 * Deterministik dedupe anahtarları (SAF). Aynı olay/kayıt/dönem için aynı anahtar çıkar; veritabanındaki
 * `unique (tenant_id, recipient_user_id, dedupe_key)` iki kez içgörü üretilmesini engeller.
 * Dönem anahtarı yeniden üretimi sınırlar: aynı kayıt için aynı kural dönem içinde tekrarlanmaz.
 */

/** TR günü "YYYY-AA-GG". */
export const dayPeriod = (nowMs: number): string => trDayKey(nowMs);

/** TR ayı "YYYY-AA". */
export const monthPeriod = (nowMs: number): string => trMonthKey(nowMs);

/** TR haftası: haftanın pazartesisinin günü "YYYY-AA-GG" (hafta anahtarı). */
export function weekPeriod(nowMs: number): string {
  const p = trParts(nowMs);
  // JS: 0=Pazar..6=Cumartesi -> pazartesiye uzaklık.
  const sinceMonday = (p.weekday + 6) % 7;
  return trDayKey(trDayStartMs(nowMs) - sinceMonday * DAY_MS);
}

const SAFE = /[^a-z0-9_:\-.]/gi;

/** `kural:kayit[:donem]` — yalnız güvenli karakterler; uzunluk 200 altı. */
export function buildDedupeKey(rule: string, entity: string | null | undefined, period?: string | null): string {
  const parts = [rule, entity ?? "-"];
  if (period) parts.push(period);
  return parts.map((p) => String(p).replace(SAFE, "_")).join(":").slice(0, 200);
}

/** Alıcı başına tekil anahtar (satır kimliği): aynı alıcıya aynı anahtar iki kez yazılmaz. */
export function recipientKey(recipientUserId: string, dedupeKey: string): string {
  return `${recipientUserId}|${dedupeKey}`;
}

/** Taslak listesindeki yinelenenleri (aynı alıcı + aynı anahtar) eler; ilk gelen kalır. */
export function dedupeDrafts<T extends { recipientUserId: string; draft: Pick<InsightDraft, "dedupeKey"> }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = recipientKey(it.recipientUserId, it.draft.dedupeKey);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Yoksay bastırması: kullanıcı bir kaydı "ilgisiz"/"yanlış" diye yoksaydıysa aynı (alıcı, kural, kayıt) üçlüsü
 * bastırma penceresi boyunca tekrar üretilmez. `suppressed` anahtarı: `${userId}|${ruleBase}|${entityId}`.
 */
export function suppressionKey(userId: string, ruleBaseName: string, entityId: string | null): string {
  return `${userId}|${ruleBaseName}|${entityId ?? "-"}`;
}

/** Bastırma penceresi (gün): "ilgilenmiyor" yoksaymaları bu kadar süre yeniden üretilmez. */
export const SUPPRESSION_DAYS = 30;
