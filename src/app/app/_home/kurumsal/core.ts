/**
 * KURUMSAL ANA EKRAN — SAF hesaplar (DB'ye ve React'e bağımlı değil; vitest kapsamında: core.test.ts).
 * Para tam TL ve ₺ önekiyle (Mn/Mr/bin kısaltması yok); tarih/saat Türkiye saatine göre (`clock.ts`).
 */
import { DAY_MS, TR_OFFSET_MS, trParts } from "@/lib/clock";

export type SalesRange = "ay" | "6ay" | "yil";
export const SALES_RANGES: readonly { key: SalesRange; label: string }[] = [
  { key: "ay", label: "Bu ay" },
  { key: "6ay", label: "Son 6 ay" },
  { key: "yil", label: "Bu yıl" },
];
export type SalesFilter = { tur?: "satilik" | "kiralik"; danisman?: string };
export type SalesRow = { value: number; createdAt: string | null; closedAt: string | null };

export function parseSalesRange(raw: string | undefined): SalesRange {
  return raw === "6ay" || raw === "yil" ? raw : "ay";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSalesFilter(tur: string | undefined, danisman: string | undefined): SalesFilter {
  return {
    ...(tur === "satilik" || tur === "kiralik" ? { tur } : {}),
    ...(danisman && UUID.test(danisman) ? { danisman } : {}),
  };
}

export const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const trMid = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TR_OFFSET_MS;

/** Dönemin [başlangıç, bitiş) anları + bir önceki eş uzunluktaki dönem. */
export function salesWindow(range: SalesRange, nowMs: number): { cur: [number, number]; prev: [number, number] } {
  const p = trParts(nowMs);
  if (range === "ay") {
    const start = trMid(p.year, p.month, 1);
    const prevStart = trMid(p.year, p.month - 1, 1);
    // Geçen ayın AYNI gününe kadar (ay ortasında adil karşılaştırma).
    const prevEnd = Math.min(start, prevStart + (nowMs - start));
    return { cur: [start, nowMs], prev: [prevStart, prevEnd] };
  }
  if (range === "6ay") {
    const start = trMid(p.year, p.month - 5, 1);
    return { cur: [start, nowMs], prev: [trMid(p.year, p.month - 11, 1), start] };
  }
  const start = trMid(p.year, 0, 1);
  const prevStart = trMid(p.year - 1, 0, 1);
  return { cur: [start, nowMs], prev: [prevStart, prevStart + (nowMs - start)] };
}

const closeMs = (r: SalesRow) => (r.closedAt ? Date.parse(r.closedAt) : NaN);
const inWin = (ms: number, [a, b]: [number, number]) => Number.isFinite(ms) && ms >= a && ms < b;

export type Delta = { pct: number; dir: "up" | "down" | "flat"; good: boolean; times?: number } | null;

/**
 * Yüzde değişim; önceki 0 ise null (oran anlamsız; kart "yeni" der). `invert`: azalış iyidir (ör. satış süresi).
 * Artış 3 katı aşarsa yüzde yerine kat yazılır (`times`): "%6300" yerine "64 kat" (okunur, abartısız).
 */
export function deltaOf(cur: number, prev: number, invert = false): Delta {
  if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(cur)) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const ratio = cur / prev;
  return { pct: Math.abs(pct), dir, good: dir === "flat" ? true : invert ? dir === "down" : dir === "up", ...(ratio >= 3 ? { times: Math.round(ratio) } : {}) };
}

export function salesSummary(rows: readonly SalesRow[], range: SalesRange, nowMs: number) {
  const w = salesWindow(range, nowMs);
  const cur = rows.filter((r) => inWin(closeMs(r), w.cur));
  const prev = rows.filter((r) => inWin(closeMs(r), w.prev));
  const total = (xs: SalesRow[]) => xs.reduce((s, r) => s + r.value, 0);
  const avgDays = (xs: SalesRow[]) => {
    const d = xs.flatMap((r) => (r.createdAt && r.closedAt ? [Math.max(0, (Date.parse(r.closedAt) - Date.parse(r.createdAt)) / DAY_MS)] : []));
    // 1 günden kısa ortalama (aynı anda açılıp kapanan kayıt) "0 gün" yazmaz: ölçülemedi sayılır.
    const avg = d.length ? Math.round(d.reduce((s, v) => s + v, 0) / d.length) : null;
    return avg != null && avg >= 1 ? avg : null;
  };
  const curAvg = avgDays(cur);
  const prevAvg = avgDays(prev);
  return {
    total: total(cur),
    totalDelta: deltaOf(total(cur), total(prev)),
    count: cur.length,
    countDelta: deltaOf(cur.length, prev.length),
    avgDays: curAvg,
    avgDelta: curAvg != null && prevAvg != null ? deltaOf(curAvg, prevAvg, true) : null,
  };
}

/** Grafik serisi: "Bu ay" günlük BİRİKİMLİ (1..bugün), "Son 6 ay" ve "Bu yıl" aylık toplam. */
export function salesSeries(rows: readonly SalesRow[], range: SalesRange, nowMs: number): { label: string; value: number }[] {
  const p = trParts(nowMs);
  if (range === "ay") {
    const out: { label: string; value: number }[] = [];
    let acc = 0;
    for (let d = 1; d <= p.day; d++) {
      const a = trMid(p.year, p.month, d);
      const b = trMid(p.year, p.month, d + 1);
      acc += rows.filter((r) => inWin(closeMs(r), [a, b])).reduce((s, r) => s + r.value, 0);
      out.push({ label: `${d} ${MONTHS_SHORT[p.month]}`, value: acc });
    }
    return out;
  }
  const months = range === "6ay" ? 6 : p.month + 1;
  const firstMonth = range === "6ay" ? p.month - 5 : 0;
  return Array.from({ length: months }, (_, i) => {
    const m = firstMonth + i;
    const a = trMid(p.year, m, 1);
    const b = trMid(p.year, m + 1, 1);
    const mm = ((m % 12) + 12) % 12;
    return { label: MONTHS_SHORT[mm]!, value: rows.filter((r) => inWin(closeMs(r), [a, b])).reduce((s, r) => s + r.value, 0) };
  });
}

/** `days` günlük kova (başlangıç anından itibaren). */
export function dailyBuckets(dates: readonly (string | null)[], startMs: number, days: number): number[] {
  const out = Array.from({ length: days }, () => 0);
  for (const iso of dates) {
    if (!iso) continue;
    const i = Math.floor((Date.parse(iso) - startMs) / DAY_MS);
    if (i >= 0 && i < days) out[i]! += 1;
  }
  return out;
}

/* ------------------------------ İlan kartı ------------------------------ */

export type ListingBadge = { label: "Fırsat" | "Yeni" | "Öne çıkan"; tone: "gold" | "brand" | "violet"; hint: string } | null;
export type ListingCard = {
  id: string;
  title: string;
  district: string | null;
  sqm: number | null;
  rooms: string | null;
  price: number | null;
  currency: string;
  transaction: string | null;
  coverSrc: string | null;
  badge: ListingBadge;
};

/**
 * Rozet VERİDEN türetilir (uydurma yok), öncelik sırasıyla: son 30 günde fiyatı düştü → "Fırsat"; son 7 günde eklendi →
 * "Yeni"; hem vitrinde hem portalda canlı → "Öne çıkan". Hiçbiri değilse rozet yok.
 */
export function listingBadge(i: { priceDropped: boolean; createdAt: string | null; published: boolean; live: boolean }, nowMs: number): ListingBadge {
  if (i.priceDropped) return { label: "Fırsat", tone: "gold", hint: "Son 30 günde fiyatı düştü" };
  if (i.createdAt && nowMs - Date.parse(i.createdAt) <= 7 * DAY_MS) return { label: "Yeni", tone: "brand", hint: "Son 7 günde eklendi" };
  if (i.published && i.live) return { label: "Öne çıkan", tone: "violet", hint: "Vitrinde ve portalda yayında" };
  return null;
}

export function transactionLabel(t: string | null): string | null {
  if (t === "sale") return "Satılık";
  if (t === "rent") return "Kiralık";
  return null;
}

/** Tam TL, ₺ önekli (kısaltma yok). Döviz portföyünde kendi simgesi. */
export function priceText(price: number | null, currency = "TRY"): string {
  if (price == null || !Number.isFinite(price)) return "Fiyat girilmedi";
  const cur = /^[A-Z]{3}$/.test(currency) ? currency : "TRY";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(price);
}

/* ------------------------------ Görevler ------------------------------ */

export type TaskCard = {
  id: string;
  title: string;
  dueAt: string | null;
  high: boolean;
  assignee: { name: string; avatarUrl: string | null; avatarPreset: string | null } | null;
};

/** Vade çipi: "3 gün gecikti" (kırmızı) · "Bugün" · "Yarın" · hafta günü · "12 Kas". */
export function dueChip(dueAt: string | null, nowMs: number): { label: string; tone: "danger" | "brand" | "neutral" } {
  if (!dueAt) return { label: "Vadesiz", tone: "neutral" };
  const due = Date.parse(dueAt);
  const p = trParts(nowMs);
  const today = trMid(p.year, p.month, p.day);
  const diff = Math.floor((due - today) / DAY_MS);
  if (diff < 0) return { label: due < nowMs && diff === -1 ? "Dün" : `${Math.abs(diff)} gün gecikti`, tone: "danger" };
  if (diff === 0) return { label: "Bugün", tone: due < nowMs ? "danger" : "brand" };
  if (diff === 1) return { label: "Yarın", tone: "neutral" };
  const dp = trParts(due);
  if (diff < 7) return { label: WEEKDAYS[dp.weekday]!, tone: "neutral" };
  return { label: `${dp.day} ${MONTHS_SHORT[dp.month]}`, tone: "neutral" };
}

/* ------------------------------ Randevu zaman çizelgesi ------------------------------ */

export type ApptStatus = { label: string; tone: "success" | "warn" | "brand" | "neutral" | "danger" };

/**
 * Randevu durum hapı (DB durumları: pending, confirmed, signature, completed, cancelled): tamamlandı · onaylandı ·
 * imza bekliyor · saati yaklaşıyor (≤60 dk) · saati geçti · planlandı (henüz teyit edilmedi).
 */
export function apptStatus(status: string | null, scheduledAt: string, nowMs: number): ApptStatus {
  if (status === "completed") return { label: "Tamamlandı", tone: "success" };
  if (status === "cancelled") return { label: "İptal", tone: "neutral" };
  const t = Date.parse(scheduledAt);
  if (Number.isFinite(t) && t >= nowMs && t - nowMs <= 60 * 60_000) return { label: "Yaklaşıyor", tone: "warn" };
  if (Number.isFinite(t) && t < nowMs) return { label: "Saati geçti", tone: "danger" };
  if (status === "confirmed") return { label: "Onaylandı", tone: "success" };
  if (status === "signature") return { label: "İmza bekliyor", tone: "brand" };
  return { label: "Planlandı", tone: "brand" };
}

/* ------------------------------ Kahraman özeti ------------------------------ */

/**
 * Kahramanın canlı özet cümlesi (resmi Türkçe, gerçek veriden): "Bugün 5 randevunuz, 3 yeni müşteri talebiniz ve 12 ilan
 * güncellemesi bekliyor." Bilinmeyen (null) ya da sıfır kalemler cümleye girmez; hiçbiri yoksa sakin bir cümle.
 */
export function heroSentence(i: { appointments: number | null; demands: number | null; listingUpdates: number | null; mine: boolean }): string {
  const parts: string[] = [];
  if (i.appointments) parts.push(`${i.appointments} randevu${i.mine ? "nuz" : ""}`);
  if (i.demands) parts.push(`${i.demands} yeni müşteri talebi${i.mine ? "niz" : ""}`);
  if (i.listingUpdates) parts.push(`${i.listingUpdates} ilan güncellemesi`);
  if (parts.length === 0) return "Bugün için bekleyen acil bir iş görünmüyor; yeni kayıtlarla güne başlayabilirsiniz.";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
  return `Bugün ${list} ${parts.length === 1 ? "bekliyor" : "sizi bekliyor"}.`;
}

/** "16 Ekim 2026, Cuma" */
export function longDate(nowMs: number): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS_LONG[p.month]} ${p.year}, ${WEEKDAYS[p.weekday]}`;
}

/** Saat dilimine göre sahne: gündüz · gün batımı · gece (Türkiye saati). */
export function sceneOf(hour: number): "day" | "dusk" | "night" {
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

