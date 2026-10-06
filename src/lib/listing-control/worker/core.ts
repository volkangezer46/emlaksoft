import { listingCheckToResult, type ListingCheckResult } from "../adapters/types";
import type { CheckResultKind, CheckState } from "../types";

/**
 * TARAYICI DOĞRULAMA İŞÇİSİ: SAF çekirdek (DOM, ağ, React, saat YOK; sunucu modülü import etmez, istemcide güvenle
 * yüklenir). Karar parçaları burada, test edilebilir; döngü/zamanlayıcı `components/listing-control/verification-worker.tsx`.
 *
 * İLKELER (adapters/types.ts ile aynı): işçi portal sayfasını SUNUCUDAN çekmez; yalnız kullanıcının kendi tarayıcısında
 * (köprü/eklenti aracılığıyla) normal görüntülenebilen fiyat/başlık/durumu bildirir. CAPTCHA/giriş duvarı/hız sınırı
 * aşılmaz: böyle bir engel `blocked` olur ve ASLA "ilan yok" sayılmaz. Yavaş hız: iş arası en az 20 sn + rastgele sapma,
 * saatte en fazla 60, oturumda en fazla 120 iş, sekme arka plandayken ve veri tasarrufu açıkken çalışmaz.
 *
 * Doğrulama mantığı (tek başarısız = şüpheli, 2-3 bağımsız kontrol = onaylı kayıp, güven seviyesi) SUNUCUDA
 * `lc_apply_check` / `check-state-machine.ts` içindedir; burada KOPYALANMAZ. İşçi yalnız gözlem taşır.
 */

export const WORKER_LIMITS = {
  /** İki iş arasındaki asgari bekleme. Sunucu RPC'si `min_interval_seconds: 20` ile aynı. */
  minIntervalMs: 20_000,
  jitterMs: 10_000,
  /** Kuyrukta iş yokken bir sonraki talebe kadar bekleme. */
  idlePollMs: 120_000,
  maxPerHour: 60,
  maxPerSession: 120,
  probeTimeoutMs: 25_000,
  errorBackoffBaseMs: 60_000,
  errorBackoffMaxMs: 15 * 60_000,
} as const;

export type WorkerEnv = {
  visible: boolean;
  online: boolean;
  saveData: boolean;
  bridgeReady: boolean;
  sessionCount: number;
  /** Son 1 saatteki tamamlanan/bırakılan iş zamanları (ms). */
  recentJobTimesMs: readonly number[];
  nowMs: number;
};

export type WorkerGate = { run: true } | { run: false; reason: "hidden" | "offline" | "save_data" | "no_bridge" | "session_cap" | "hour_cap" };

/** Çalışma kapısı. Her koşul "çalışma" yönünde muhafazakârdır. */
export function workerGate(env: WorkerEnv): WorkerGate {
  if (!env.visible) return { run: false, reason: "hidden" };
  if (!env.online) return { run: false, reason: "offline" };
  if (env.saveData) return { run: false, reason: "save_data" };
  if (!env.bridgeReady) return { run: false, reason: "no_bridge" };
  if (env.sessionCount >= WORKER_LIMITS.maxPerSession) return { run: false, reason: "session_cap" };
  const hourAgo = env.nowMs - 3_600_000;
  if (env.recentJobTimesMs.filter((t) => t > hourAgo).length >= WORKER_LIMITS.maxPerHour) return { run: false, reason: "hour_cap" };
  return { run: true };
}

export type StepOutcome = "done" | "idle" | "busy" | "rate_limited" | "error" | "client_invalid";

/** Sonraki adıma kadar bekleme (ms). `rand` 0..1 (testte verilir; üretimde Math.random). */
export function nextDelayMs(outcome: StepOutcome, consecutiveErrors: number, rand: number): number {
  const r = Math.min(Math.max(rand, 0), 1);
  switch (outcome) {
    case "done":
      return WORKER_LIMITS.minIntervalMs + Math.round(r * WORKER_LIMITS.jitterMs);
    case "idle":
      return WORKER_LIMITS.idlePollMs + Math.round(r * WORKER_LIMITS.jitterMs * 3);
    case "busy":
      return WORKER_LIMITS.minIntervalMs * 3;
    case "rate_limited":
      return 10 * 60_000;
    case "client_invalid":
      return WORKER_LIMITS.errorBackoffMaxMs;
    case "error":
      return errorBackoffMs(consecutiveErrors);
  }
}

/** Üstel geri çekilme: 1 dk, 2 dk, 4 dk ... en çok 15 dk. */
export function errorBackoffMs(consecutiveErrors: number): number {
  const n = Math.max(1, Math.floor(consecutiveErrors));
  return Math.min(WORKER_LIMITS.errorBackoffMaxMs, WORKER_LIMITS.errorBackoffBaseMs * 2 ** (n - 1));
}

/** Köprüden (eklenti) gelen ham yanıt. Hiçbir alana güvenilmez: aşağıda doğrulanır. */
export type ProbeReply = {
  /** Portal ilanı gördü mü? null = belirlenemedi. */
  found?: boolean | null;
  /** Portalın AÇIK "bulunamadı/yayından kaldırıldı" işareti (HTTP 404/410 ya da adaptörün tanıdığı ibare). `absent` için ŞART. */
  notFound?: boolean;
  price?: number | null;
  title?: string | null;
  advisorName?: string | null;
  status?: string | null;
  /** http_429, captcha, login_required, timeout, parse_error ... */
  error?: string | null;
};

export type WorkerReport = {
  result: CheckResultKind;
  observed: { price?: number; title?: string; advisor_name?: string; status?: string; error_code?: string };
};

function cleanText(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

/**
 * Köprü yanıtını sunucuya gidecek rapora çevirir. MUHAFAZAKÂR: "ilan yok" (absent) yalnız hata YOKKEN ve portal açıkça
 * "bulunamadı" işareti verdiyse üretilir; belirsiz her şey error/blocked olur (sunucu bunu asla kayıp saymaz).
 */
export function replyToReport(reply: unknown, seenAtIso: string): WorkerReport {
  const o = (typeof reply === "object" && reply !== null ? reply : {}) as ProbeReply;
  const error = cleanText(o.error, 60) ?? null;
  const found = o.found === true ? true : o.found === false && o.notFound === true && !error ? false : null;
  const price = typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0 && o.price < 1e12 ? o.price : null;
  const check: ListingCheckResult = {
    found,
    active: found,
    price,
    title: cleanText(o.title, 300) ?? null,
    advisorName: cleanText(o.advisorName, 120) ?? null,
    listingNo: null,
    seenAt: seenAtIso,
    confidence: 0.7,
    error: found === null && !error ? "indeterminate" : error,
  };
  const result = listingCheckToResult(check);
  const observed: WorkerReport["observed"] = {};
  if (result === "present") {
    if (price !== null) observed.price = price;
    if (check.title) observed.title = check.title;
    if (check.advisorName) observed.advisor_name = check.advisorName;
    const status = cleanText(o.status, 40);
    if (status) observed.status = status;
  } else if (result !== "absent") {
    observed.error_code = check.error ?? "error";
  }
  return { result, observed };
}

export type ConfidenceLevel = "yuksek" | "orta" | "dusuk" | "yok";

/** Güven seviyesi (arayüz etiketi). Sunucudaki 0.30/0.70/0.85-0.95 basamaklarıyla uyumlu eşikler. */
export function confidenceLevel(state: CheckState | string | null | undefined, confidence: number | null | undefined): ConfidenceLevel {
  if (state === "unchecked" || state === "unverifiable" || state === "paused" || confidence === null || confidence === undefined) return "yok";
  if (confidence >= 0.85) return "yuksek";
  if (confidence >= 0.6) return "orta";
  return "dusuk";
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  yuksek: "Yüksek güven",
  orta: "Orta güven",
  dusuk: "Düşük güven",
  yok: "Güven hesaplanamadı",
};

/** Portal URL'si bu adaptörün host listesinde ve https mi? Köprüye yalnız doğrulanmış URL verilir. */
export function isAllowedProbeUrl(url: string | null | undefined, hosts: readonly string[]): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
