/**
 * Raporlar dönem + kapsam seçimi (SAF; saat okumaz, "bugün" anahtarı çağırandan gelir).
 *
 * URL kontratı (iki yönlü filtre): `?donem=bu-ay|gecen-ay|bu-ceyrek|gecen-ceyrek|bu-yil|gecen-yil|son-90|ozel`
 * + özel aralıkta `?baslangic=YYYY-AA-GG&bitis=YYYY-AA-GG`; kapsam `?sube=<uuid>&takim=<uuid>&danisman=<uuid>`.
 * Dönem uçları İstanbul takvim günüdür ve DAHİLDİR; RPC'ler (report_period_overview, report_sales_funnel,
 * deal_stage_velocity) aynı (p_from, p_to) çiftini alır, karşılaştırma aynı uzunlukta hemen önceki dönemdir.
 */

export const PERIOD_PRESETS = [
  { value: "bu-ay", label: "Bu ay" },
  { value: "gecen-ay", label: "Geçen ay" },
  { value: "bu-ceyrek", label: "Bu çeyrek" },
  { value: "gecen-ceyrek", label: "Geçen çeyrek" },
  { value: "bu-yil", label: "Bu yıl" },
  { value: "son-90", label: "Son 90 gün" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["value"] | "ozel";

export type ReportPeriod = {
  key: PeriodPreset;
  /** Dahil başlangıç günü (YYYY-AA-GG). */
  from: string;
  /** Dahil bitiş günü (YYYY-AA-GG). */
  to: string;
  /** Ekranda dönem adı ("Bu ay", "1.07.2026 – 30.09.2026"). */
  label: string;
  /** Önceki eşdeğer dönem (karşılaştırma). */
  prevFrom: string;
  prevTo: string;
  /** Gün sayısı (dahil). */
  days: number;
};

export type ReportScope = { branchId: string | null; teamId: string | null; profileId: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Özel aralık üst sınırı (RPC'ler 1100 günden uzununu reddeder). */
export const MAX_PERIOD_DAYS = 1095;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isDateKey(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = parseKey(v);
  return !Number.isNaN(d.getTime()) && toKey(d) === v;
}

export function addDays(key: string, delta: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + delta);
  return toKey(d);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / 86_400_000) + 1;
}

function monthStart(y: number, m0: number): string {
  return toKey(new Date(Date.UTC(y, m0, 1)));
}

function monthEnd(y: number, m0: number): string {
  return toKey(new Date(Date.UTC(y, m0 + 1, 0)));
}

export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${Number(d)}.${m}.${y}`;
}

/** Ekranda aralık metni: "1.07.2026 – 30.09.2026". */
export function rangeLabel(from: string, to: string): string {
  return from === to ? formatDayKey(from) : `${formatDayKey(from)} – ${formatDayKey(to)}`;
}

/**
 * URL parametrelerinden dönem. Geçersiz/eksik değer varsayılana (bu ay) düşer; özel aralıkta ters uçlar yer değiştirir,
 * gelecek günler bugüne kırpılır, MAX_PERIOD_DAYS aşılırsa başlangıç geri çekilir.
 */
export function resolveReportPeriod(
  sp: Record<string, string | string[] | undefined>,
  todayKey: string,
  fallback: PeriodPreset = "bu-ay",
): ReportPeriod {
  const raw = one(sp.donem);
  const key: PeriodPreset =
    raw === "ozel" || PERIOD_PRESETS.some((p) => p.value === raw) ? (raw as PeriodPreset) : fallback;
  const [y, m] = todayKey.split("-").map(Number);
  const m0 = m - 1;
  const q0 = Math.floor(m0 / 3) * 3;
  let from: string;
  let to: string;
  switch (key) {
    case "gecen-ay":
      from = monthStart(y, m0 - 1);
      to = monthEnd(y, m0 - 1);
      break;
    case "bu-ceyrek":
      from = monthStart(y, q0);
      to = todayKey;
      break;
    case "gecen-ceyrek":
      from = monthStart(y, q0 - 3);
      to = monthEnd(y, q0 - 1);
      break;
    case "bu-yil":
      from = monthStart(y, 0);
      to = todayKey;
      break;
    case "son-90":
      from = addDays(todayKey, -89);
      to = todayKey;
      break;
    case "ozel": {
      let a = one(sp.baslangic);
      let b = one(sp.bitis);
      if (!isDateKey(a) && !isDateKey(b)) return resolveReportPeriod({}, todayKey, fallback);
      if (!isDateKey(a)) a = monthStart(y, m0);
      if (!isDateKey(b)) b = todayKey;
      if (a > b) [a, b] = [b, a];
      if (b > todayKey) b = todayKey;
      if (a > b) a = b;
      if (daysBetweenInclusive(a, b) > MAX_PERIOD_DAYS) a = addDays(b, -(MAX_PERIOD_DAYS - 1));
      from = a;
      to = b;
      break;
    }
    default:
      from = monthStart(y, m0);
      to = todayKey;
  }
  const days = daysBetweenInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  const preset = PERIOD_PRESETS.find((p) => p.value === key);
  return { key, from, to, days, prevFrom, prevTo, label: preset ? preset.label : rangeLabel(from, to) };
}

/** URL'deki kapsam; geçersiz kimlik yok sayılır. Kapsam izni olmayan izleyicide çağıran null geçirmelidir. */
export function resolveReportScope(sp: Record<string, string | string[] | undefined>): ReportScope {
  const id = (k: string) => {
    const v = one(sp[k]).trim();
    return UUID_RE.test(v) ? v : null;
  };
  return { branchId: id("sube"), teamId: id("takim"), profileId: id("danisman") };
}

export function scopeActive(s: ReportScope): boolean {
  return Boolean(s.branchId || s.teamId || s.profileId);
}

/** Dönem + kapsamı URL parametrelerine yazar (bağlantılar aynı süzgeci taşır). */
export function periodScopeParams(p: ReportPeriod, s: ReportScope): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.key !== "bu-ay") out.donem = p.key;
  if (p.key === "ozel") {
    out.baslangic = p.from;
    out.bitis = p.to;
  }
  if (s.branchId) out.sube = s.branchId;
  if (s.teamId) out.takim = s.teamId;
  if (s.profileId) out.danisman = s.profileId;
  return out;
}

/** RPC parametreleri. */
export function periodScopeRpcArgs(p: ReportPeriod, s: ReportScope) {
  return { p_from: p.from, p_to: p.to, p_branch: s.branchId, p_team: s.teamId, p_profile: s.profileId };
}

/**
 * Önceki döneme göre değişim yüzdesi (yuvarlanmış). Önceki 0 ise ve şimdi > 0 ise null (sonsuz artış gösterilmez,
 * "yeni" denir); ikisi de 0 ise 0.
 */
export function changePct(current: number, previous: number): number | null {
  if (!(previous > 0)) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}
