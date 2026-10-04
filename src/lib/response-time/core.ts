/**
 * İlk yanıt süresi (lead hızı) — SAF hesap katmanı.
 *
 * TANIM (belge ONERI Ö-3): ilk yanıt = müşteri kaydının açılışı ile o müşteriye yapılan ilk
 * "gerçek temas" (giden iletişim kaydı: çağrı/WhatsApp/SMS/e-posta/görüşme; ya da cevapsız
 * OLMAYAN çağrı) arasındaki geçen süre. Not ve dahili kayıtlar temas sayılmaz.
 * ÇALIŞMA SAATİ DIŞI HARİÇ: süre yalnız Türkiye saatiyle Pzt-Cmt 09:00-19:00 aralığından sayılır
 * (gece/pazar gelen talep sabah ilk saatte "0 dakika" borçla başlar). Aralık varsayılanı sabittir;
 * ofis ayarı şema gerektirdiğinden sonraya bırakıldı (bkz. docs notu), eşik ise URL'den seçilir.
 * ÖLÇÜLEMEYEN KAYIT sıfır sayılmaz: yanıtsız ve eşiği aşmamışsa "bekliyor", geçmişse "gecikti".
 *
 * Saflık: "şimdi" dışarıdan (nowMs) gelir; bileşenlerde Date.now() yasağına takılmaz.
 */
import { DAY_MS, trDayStartMs, trParts } from "@/lib/clock";

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 19;
/** Haftalık çalışma günleri (0=Pazar). Pazar kapalı. */
const WORK_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6];
/** Hesap tavanı: bundan eski aralıklar için gün döngüsü kesilir. */
const MAX_SPAN_DAYS = 120;

export const SLA_OPTIONS_MIN = [15, 30, 60, 120, 240] as const;
export const DEFAULT_SLA_MIN = 60;

/** Temas sayılan iletişim kanalları (not/dahili HARİÇ). */
export const TOUCH_CHANNELS: readonly string[] = ["call", "whatsapp", "sms", "email", "meeting"];

/** `startMs`-`endMs` arasındaki çalışma dakikası (TR takvimi). endMs <= startMs ise 0. */
export function workingMinutesBetween(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let total = 0;
  let dayStart = trDayStartMs(startMs);
  for (let i = 0; i <= MAX_SPAN_DAYS && dayStart < endMs; i += 1) {
    if (WORK_WEEKDAYS.includes(trParts(dayStart + 12 * 3_600_000).weekday)) {
      const winStart = dayStart + WORK_START_HOUR * 3_600_000;
      const winEnd = dayStart + WORK_END_HOUR * 3_600_000;
      const from = Math.max(winStart, startMs);
      const to = Math.min(winEnd, endMs);
      if (to > from) total += (to - from) / 60_000;
    }
    dayStart += DAY_MS;
  }
  return Math.round(total);
}

export type TouchPoint = { at: string; kind: "comm" | "call" };

export type LeadInput = {
  customerId: string;
  name: string;
  assignedTo: string | null;
  createdAt: string;
};

export type LeadResponseStatus = "hizli" | "gecikti" | "bekliyor" | "bekliyor_gec";

export type LeadResponse = LeadInput & {
  firstTouchAt: string | null;
  /** Yanıtlandıysa yanıt süresi, yanıtsızsa bekleme süresi (çalışma dakikası). */
  minutes: number;
  responded: boolean;
  /** hizli: eşik içinde yanıtlandı · gecikti: yanıtlandı ama eşik aşıldı ·
   *  bekliyor: yanıtsız, eşik içinde · bekliyor_gec: yanıtsız ve eşik aşıldı. */
  status: LeadResponseStatus;
};

/** Geçerli temaslar: kayıt açılışından SONRAKİ en erken olan. */
export function firstTouchAfter(createdAt: string, touches: readonly TouchPoint[]): string | null {
  const c = Date.parse(createdAt);
  if (Number.isNaN(c)) return null;
  let best: number | null = null;
  for (const t of touches) {
    const ms = Date.parse(t.at);
    if (Number.isNaN(ms) || ms < c) continue;
    if (best === null || ms < best) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

export function measureLead(
  lead: LeadInput,
  touches: readonly TouchPoint[],
  slaMin: number,
  nowMs: number,
): LeadResponse | null {
  const created = Date.parse(lead.createdAt);
  if (Number.isNaN(created)) return null; // ölçülemez: 0 sayılmaz, listeye girmez
  const first = firstTouchAfter(lead.createdAt, touches);
  if (first) {
    const minutes = workingMinutesBetween(created, Date.parse(first));
    return { ...lead, firstTouchAt: first, minutes, responded: true, status: minutes <= slaMin ? "hizli" : "gecikti" };
  }
  const minutes = workingMinutesBetween(created, nowMs);
  return {
    ...lead,
    firstTouchAt: null,
    minutes,
    responded: false,
    status: minutes > slaMin ? "bekliyor_gec" : "bekliyor",
  };
}

export type ResponseSummary = {
  total: number;
  responded: number;
  waiting: number;
  /** Yanıtlanan kayıtların ortalaması (dk); yanıtlanan yoksa null ("veri yok"). */
  avgMin: number | null;
  /** Medyan (dk); yanıtlanan yoksa null. */
  medianMin: number | null;
  /** Eşik içinde yanıtlanan / yanıtlanan (%); yanıtlanan yoksa null. */
  withinSlaPct: number | null;
  /** Şu an eşiği aşmış yanıtsız kayıt sayısı. */
  overdueWaiting: number;
};

export function summarizeResponses(rows: readonly LeadResponse[]): ResponseSummary {
  const done = rows.filter((r) => r.responded).map((r) => r.minutes);
  const sorted = [...done].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const within = rows.filter((r) => r.status === "hizli").length;
  return {
    total: rows.length,
    responded: done.length,
    waiting: rows.filter((r) => !r.responded).length,
    avgMin: done.length ? Math.round(done.reduce((s, n) => s + n, 0) / done.length) : null,
    medianMin: median,
    withinSlaPct: done.length ? Math.round((within / done.length) * 100) : null,
    overdueWaiting: rows.filter((r) => r.status === "bekliyor_gec").length,
  };
}

export type AdvisorResponseRow = { advisorId: string | null; summary: ResponseSummary };

/** Danışman bazlı özet (atanmamış kayıtlar advisorId=null satırında). */
export function summarizeByAdvisor(rows: readonly LeadResponse[]): AdvisorResponseRow[] {
  const groups = new Map<string | null, LeadResponse[]>();
  for (const r of rows) {
    const list = groups.get(r.assignedTo) ?? [];
    list.push(r);
    groups.set(r.assignedTo, list);
  }
  return [...groups.entries()]
    .map(([advisorId, list]) => ({ advisorId, summary: summarizeResponses(list) }))
    .sort((a, b) => b.summary.overdueWaiting - a.summary.overdueWaiting || b.summary.total - a.summary.total);
}

/** "42 dk", "3 sa 10 dk"; null → "Veri yok". */
export function formatMinutes(min: number | null): string {
  if (min === null) return "Veri yok";
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}
