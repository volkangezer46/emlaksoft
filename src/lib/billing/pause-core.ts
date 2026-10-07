import { DAY_MS } from "@/lib/clock";

/**
 * ABONELİK DURAKLATMA: SAF KURALLAR (I/O yok; istemci ve sunucu paylaşır).
 * SQL (`subscription_pause` / `subscription_resume`, 20261007001000) aynı kuralların SON hakemidir; buradaki kopya
 * ekran önizlemesi, hata metni eşlemesi ve birim testi içindir. Değiştirirsen ikisini birlikte değiştir.
 *
 *  - Yalnız ofis sahibi duraklatır; aktif (status=active), dönemi süren, iptal talebi olmayan abonelik.
 *  - En çok `billing.pause_max_days` gün (varsayılan 30, 1..90); 365 günde 1 kez.
 *  - Duraklatmada veri SALT-OKUNUR: yazma eylemleri reddedilir (fatura/abonelik modülü hariç ki devam ettirilebilsin).
 *  - Devamda dönem sonu GERÇEK duraklatma süresi kadar uzar (planlı bitişi aşamaz).
 */

export const PAUSE_DEFAULT_MAX_DAYS = 30;
export const PAUSE_MIN_DAYS = 1;
export const PAUSE_ABSOLUTE_MAX_DAYS = 90;
/** Yıllık sınır penceresi: son duraklatmanın başlangıcından itibaren. */
export const PAUSE_YEARLY_WINDOW_DAYS = 365;

export const PAUSE_BLOCK_MESSAGE =
  "Aboneliğiniz duraklatıldı: verileriniz salt-okunur. Devam etmek için Paket ve ödeme ekranından aboneliği devam ettirin.";

/** Ayar değerini (ham metin ya da sayı) 1..90 aralığına çevirir; bozuksa varsayılan. */
export function clampPauseMaxDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^[0-9]{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < PAUSE_MIN_DAYS || n > PAUSE_ABSOLUTE_MAX_DAYS) return PAUSE_DEFAULT_MAX_DAYS;
  return n;
}

export type PauseRefusalCode =
  | "disabled"
  | "not_owner"
  | "invalid_days"
  | "too_long"
  | "no_subscription"
  | "already_paused"
  | "not_active"
  | "period_over"
  | "cancel_pending"
  | "yearly_limit"
  | "not_paused";

export type PauseInput = {
  enabled: boolean;
  role: string;
  /** subscriptions.status */
  status: string | null;
  periodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  /** Şu an duraklatılmışsa başlangıç. */
  pausedAtMs: number | null;
  /** Son duraklatmanın başlangıcı (devamdan sonra da kalır). */
  lastStartedMs: number | null;
  maxDays: number;
  days: number;
  nowMs: number;
};

export type PauseDecision =
  | { ok: true; endsAtMs: number }
  | { ok: false; code: PauseRefusalCode; message: string; nextAllowedAtMs?: number };

const fmtDate = (ms: number) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(ms));

export function pauseRefusalMessage(code: PauseRefusalCode, extra?: { maxDays?: number; nextAllowedAtMs?: number }): string {
  switch (code) {
    case "disabled":
      return "Abonelik duraklatma şu an etkin değil.";
    case "not_owner":
      return "Aboneliği yalnızca ofis sahibi duraklatabilir.";
    case "invalid_days":
      return "Duraklatma süresi için geçerli bir gün sayısı girin.";
    case "too_long":
      return `Bir duraklatma en fazla ${extra?.maxDays ?? PAUSE_DEFAULT_MAX_DAYS} gün olabilir.`;
    case "no_subscription":
      return "Abonelik kaydı bulunamadı.";
    case "already_paused":
      return "Abonelik zaten duraklatılmış.";
    case "not_active":
      return "Yalnızca aktif ücretli abonelik duraklatılabilir (deneme veya gecikmiş abonelikte kapalı).";
    case "period_over":
      return "Dönem sona erdiği için duraklatılamaz; önce aboneliği yenileyin.";
    case "cancel_pending":
      return "İptal talebi olan abonelik duraklatılamaz; önce iptal talebini geri alın.";
    case "yearly_limit":
      return extra?.nextAllowedAtMs
        ? `Yılda en fazla 1 kez duraklatabilirsiniz. Bir sonraki duraklatma ${fmtDate(extra.nextAllowedAtMs)} tarihinden sonra yapılabilir.`
        : "Yılda en fazla 1 kez duraklatabilirsiniz.";
    case "not_paused":
      return "Abonelik duraklatılmış değil.";
  }
}

/** Duraklatma izni (SQL `subscription_pause` ile aynı sıra). */
export function evaluatePause(input: PauseInput): PauseDecision {
  const refuse = (code: PauseRefusalCode, extra?: { nextAllowedAtMs?: number }): PauseDecision => ({
    ok: false,
    code,
    message: pauseRefusalMessage(code, { maxDays: input.maxDays, nextAllowedAtMs: extra?.nextAllowedAtMs }),
    ...(extra?.nextAllowedAtMs ? { nextAllowedAtMs: extra.nextAllowedAtMs } : {}),
  });
  if (!input.enabled) return refuse("disabled");
  if (input.role !== "owner") return refuse("not_owner");
  if (!Number.isInteger(input.days) || input.days < PAUSE_MIN_DAYS) return refuse("invalid_days");
  if (input.days > input.maxDays) return refuse("too_long");
  if (input.pausedAtMs != null) return refuse("already_paused");
  if (input.status !== "active") return refuse("not_active");
  if (input.periodEndMs == null || input.periodEndMs <= input.nowMs) return refuse("period_over");
  if (input.cancelAtPeriodEnd) return refuse("cancel_pending");
  if (input.lastStartedMs != null && input.lastStartedMs > input.nowMs - PAUSE_YEARLY_WINDOW_DAYS * DAY_MS) {
    return refuse("yearly_limit", { nextAllowedAtMs: input.lastStartedMs + PAUSE_YEARLY_WINDOW_DAYS * DAY_MS });
  }
  return { ok: true, endsAtMs: input.nowMs + input.days * DAY_MS };
}

/** Devamdaki uzama süresi (ms): gerçek duraklatma, planlı bitişi aşamaz. */
export function resumeExtensionMs(startedMs: number, endsMs: number, nowMs: number): number {
  return Math.max(0, Math.min(nowMs, endsMs) - startedMs);
}

/** Devamdan sonra yeni dönem sonu. */
export function resumedPeriodEndMs(periodEndMs: number, startedMs: number, endsMs: number, nowMs: number): number {
  return periodEndMs + resumeExtensionMs(startedMs, endsMs, nowMs);
}

/** Duraklatılmış ofiste bu eylem engellenir mi? Okuma ve abonelik/ödeme modülü (devam ettirmek için) serbesttir. */
export function isPausedWriteBlocked(paused: boolean, mod: string, action: string): boolean {
  if (!paused) return false;
  if (action === "view") return false;
  return mod !== "billing";
}

export type PauseRow = { pause_started_at?: string | null; pause_ends_at?: string | null };

export type PauseView = { paused: boolean; startedAtMs: number | null; endsAtMs: number | null };

export function pauseViewOf(row: PauseRow | null | undefined): PauseView {
  const started = row?.pause_started_at ? Date.parse(row.pause_started_at) : NaN;
  const ends = row?.pause_ends_at ? Date.parse(row.pause_ends_at) : NaN;
  if (!Number.isFinite(started)) return { paused: false, startedAtMs: null, endsAtMs: null };
  return { paused: true, startedAtMs: started, endsAtMs: Number.isFinite(ends) ? ends : null };
}
