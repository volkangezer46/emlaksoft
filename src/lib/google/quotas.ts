/**
 * Google kota defteri (SAF). Sınırın %80'ine gelindiğinde DURULUR: kalan pay elle yapılacak işlere ve beklenmedik
 * yeniden denemelere bırakılır. Günlük sayaç `google.quota.<ad>` (mühürlü) içinde gün anahtarıyla tutulur; yeni günde sıfırlanır.
 */

export const QUOTA_STOP_RATIO = 0.8;

export const GOOGLE_QUOTAS = {
  /** Search Console API: dakikada 1200 sorgu (mülk başına). */
  gscPerMinute: 1200,
  /** URL Inspection: günde 2000 inceleme (mülk başına). */
  inspectionPerDay: 2000,
  /** Google Ads API (Basic erişim): günde 2.880 işlem. */
  adsPerDay: 2880,
} as const;

/** Bizim günlük URL inceleme tavanımız (Q2): Google sınırından bağımsız, çok daha küçük. */
export const INSPECTION_DAILY_CAP = 50;

export type QuotaName = "gsc" | "inspection" | "ads";

export function stopAt(limit: number): number {
  return Math.floor(limit * QUOTA_STOP_RATIO);
}

/** Bir pencere (gün ya da dakika) için sayaç. `tryConsume` %80 eşiğini aşacaksa reddeder. */
export class QuotaWindow {
  private used: number;

  constructor(
    readonly limit: number,
    used = 0,
  ) {
    this.used = Math.max(0, Math.floor(used));
  }

  get count(): number {
    return this.used;
  }

  get stopThreshold(): number {
    return stopAt(this.limit);
  }

  get exhausted(): boolean {
    return this.used >= this.stopThreshold;
  }

  remaining(): number {
    return Math.max(0, this.stopThreshold - this.used);
  }

  tryConsume(n = 1): boolean {
    if (this.used + n > this.stopThreshold) return false;
    this.used += n;
    return true;
  }
}

/** Günlük sayaç: kayıt başka güne aitse sıfırdan başlar. */
export function dailyWindow(limit: number, record: { day: string; used: number } | null, today: string): QuotaWindow {
  return new QuotaWindow(limit, record && record.day === today ? record.used : 0);
}

/**
 * Dakikalık sayaç (Search Console QPM): pencere değişince sıfırlanır. Saat dışarıdan verilir (test).
 * %80'de `tryConsume` false döner; çağıran bu turu bırakır (beklemez: cron süresi sınırlı).
 */
export class MinuteWindow {
  private minute = -1;
  private window: QuotaWindow;

  constructor(
    readonly limit: number,
    private readonly clock: () => number,
  ) {
    this.window = new QuotaWindow(limit);
  }

  tryConsume(n = 1): boolean {
    const m = Math.floor(this.clock() / 60_000);
    if (m !== this.minute) {
      this.minute = m;
      this.window = new QuotaWindow(this.limit);
    }
    return this.window.tryConsume(n);
  }
}

export class QuotaExceededError extends Error {
  constructor(readonly quota: QuotaName) {
    super(`Google kota eşiği (%${Math.round(QUOTA_STOP_RATIO * 100)}) doldu: ${quota}`);
    this.name = "QuotaExceededError";
  }
}
