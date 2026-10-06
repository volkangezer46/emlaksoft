import type { CadenceConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import type { CheckState } from "./types";

/**
 * Akıllı kontrol sıklığı ve kuyruğa alma kararı (SAF). Hangi ilan NE ZAMAN kuyruğa girer:
 *   şüpheli/olası kayıp yeniden kontrolü  → suspectRecheckMinutes (varsayılan 15 dk)
 *   başarısız (blocked/error)              → üstel geri çekilme 30 → 60 → 120 → 240 dk (ayarlanabilir)
 *   kritik (risk ≥ eşik / fiyat farkı / yetki sorunu) → criticalHours (6 saat)
 *   yeni ilan (ilk newListingDays gün)     → newListingHours (6 saat)
 *   60+ gün yaşlı ilan                     → oldListingHours (12 saat)
 *   diğer                                  → normalHours (24 saat)
 * Kullanıcı devre dışı bıraktığı (`paused`) ilan kuyruğa ALINMAZ.
 */

export type CadenceInput = {
  state: CheckState;
  /** İlk yayın zamanı (ISO) ya da null. */
  publishedAt: string | null;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  checkFailures: number;
  riskScore: number;
  priceMismatch: boolean;
  authorityIssue: boolean;
};

export type CadenceDecision = {
  /** Hedef aralık (dk) — bu ilan için en sık gereken. */
  intervalMinutes: number;
  reason: "suspect_recheck" | "failure_backoff" | "critical" | "new_listing" | "old_listing" | "normal";
  /** Kuyruğa girmeli mi (şimdi). */
  due: boolean;
  /** Bir sonraki planlı zaman (ISO). */
  dueAt: string;
  /** Kuyruk önceliği (büyük önce). */
  priority: number;
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function decideCadence(
  input: CadenceInput,
  nowMs: number,
  cfg: CadenceConfig = DEFAULT_LISTING_CONTROL_CONFIG.cadence,
): CadenceDecision | null {
  if (input.state === "paused") return null;

  let intervalMin: number;
  let reason: CadenceDecision["reason"];
  let priority: number;

  if (input.state === "suspect" || input.state === "probable_missing") {
    intervalMin = cfg.suspectRecheckMinutes;
    reason = "suspect_recheck";
    priority = 90;
  } else if (input.checkFailures > 0 && input.state === "unverifiable") {
    intervalMin = Math.min(
      cfg.failureBackoffMaxMinutes,
      cfg.failureBackoffBaseMinutes * 2 ** Math.min(input.checkFailures - 1, 3),
    );
    reason = "failure_backoff";
    priority = 40;
  } else if (
    input.riskScore >= cfg.criticalRiskThreshold ||
    input.priceMismatch ||
    input.authorityIssue ||
    input.state === "confirmed_missing"
  ) {
    intervalMin = cfg.criticalHours * 60;
    reason = "critical";
    priority = 70;
  } else {
    const ageMs = input.publishedAt ? nowMs - Date.parse(input.publishedAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(ageMs) && ageMs < cfg.newListingDays * DAY) {
      intervalMin = cfg.newListingHours * 60;
      reason = "new_listing";
      priority = 60;
    } else if (Number.isFinite(ageMs) && ageMs >= cfg.oldListingDays * DAY) {
      intervalMin = cfg.oldListingHours * 60;
      reason = "old_listing";
      priority = 30;
    } else {
      intervalMin = cfg.normalHours * 60;
      reason = "normal";
      priority = 20;
    }
  }

  const base = input.lastCheckAt ? Date.parse(input.lastCheckAt) : Number.NEGATIVE_INFINITY;
  const byInterval = Number.isFinite(base) ? base + intervalMin * MIN : nowMs;
  // RPC'nin yazdığı next_check_at daha erkense (ör. şüpheli 10 dk) ona saygı göster; sonraki zamanı hedef aralık sınırlar.
  const stored = input.nextCheckAt ? Date.parse(input.nextCheckAt) : Number.NaN;
  const dueMs = Number.isFinite(stored) ? Math.min(stored, byInterval) : byInterval;
  return {
    intervalMinutes: intervalMin,
    reason,
    due: dueMs <= nowMs,
    dueAt: new Date(dueMs).toISOString(),
    priority,
  };
}

/** Son başarılı kontrolü `staleAfterHours`'tan eski ilan "kontrol edilemeyen" tazelik sınırını aşar (yanlış kayıp ÜRETİLMEZ). */
export function isCheckStale(lastSuccessAt: string | null, nowMs: number, cfg: CadenceConfig = DEFAULT_LISTING_CONTROL_CONFIG.cadence): boolean {
  if (!lastSuccessAt) return true;
  return nowMs - Date.parse(lastSuccessAt) > cfg.staleAfterHours * HOUR;
}
