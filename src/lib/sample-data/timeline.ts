import { DAY_MS, trDayKey, trDayStartMs } from "@/lib/clock";

/**
 * ÖRNEK VERİ ZAMAN ÇİZELGESİ — SAF (ağ/DB yok; deterministik). Demo kayıtların `created_at` ve iş tarihleri son ~6 aya
 * gerçekçi biçimde yayılır: aylar yavaşça büyüyen bir ofis gibi dolar, bulunulan ay yalnız geçen gün kadar pay alır
 * ("bu ay 135 yeni" gibi şişkin KPI çıkmaz), saatler TR mesai saatindedir ve HİÇBİR an gelecekte değildir.
 * Bağımlı kayıt (talep → müşteriden sonra, anlaşma → müşteri ve portföyden sonra, komisyon → kazanılmış anlaşmadan
 * sonra) `after` ile kurulur; böylece zaman çizelgeleri ve tutarlılık değişmezleri (demo-seed-invariants) bozulmaz.
 */

export type Rng = () => number;

/** FNV-1a tohumlu mulberry32: aynı tohum aynı diziyi üretir (testler ve tekrar yükleme aynı görünür). */
export function createRng(seed: string): Rng {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Gelecek damga koruması: en geç "şimdi - 20 dk". */
export const FUTURE_GUARD_MS = 20 * 60_000;

/** TR mesai saatinde (09:00–19:00) bir an; gün başlangıcı TR günüdür. */
export function businessHourMs(dayMs: number, rng: Rng): number {
  const start = trDayStartMs(dayMs);
  const minutes = 9 * 60 + Math.floor(rng() * 10 * 60);
  return start + minutes * 60_000;
}

function clampPast(ms: number, nowMs: number): number {
  return Math.min(ms, nowMs - FUTURE_GUARD_MS);
}

/** Bulunulan TR ayının ilk günü (epoch ms) ve ayda geçen gün oranı. */
function monthInfo(nowMs: number): { monthStartMs: number; elapsedShare: number } {
  const key = trDayKey(nowMs); // YYYY-MM-DD
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const monthStartMs = trDayStartMs(Date.UTC(y, m - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { monthStartMs, elapsedShare: Math.max(1, d) / daysInMonth };
}

/**
 * `count` anı son `months` aya yayar (artan sırada). Ay ağırlıkları eskiden yeniye büyür (büyüyen ofis); bulunulan
 * ayın ağırlığı geçen gün oranıyla çarpılır. Her an mesai saatinde ve geçmiştedir.
 */
export function spreadOverMonths(input: { count: number; nowMs: number; months?: number; rng: Rng }): number[] {
  const months = Math.max(1, input.months ?? 6);
  const n = Math.max(0, Math.floor(input.count));
  if (n === 0) return [];
  const { monthStartMs, elapsedShare } = monthInfo(input.nowMs);
  // ay i: 0 = en eski ... months = bulunulan ay
  const weights: number[] = [];
  for (let i = 0; i <= months; i++) weights.push(1 + i * 0.18);
  weights[months] = weights[months]! * elapsedShare;
  const total = weights.reduce((s, w) => s + w, 0);
  // En büyük kalan yöntemiyle tam sayı paylaştırma (toplam tam n).
  const raw = weights.map((w) => (w / total) * n);
  const base = raw.map(Math.floor);
  let rest = n - base.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k]!.i]! += 1;

  const out: number[] = [];
  for (let i = 0; i <= months; i++) {
    const back = months - i;
    const start = back === 0 ? monthStartMs : shiftMonths(monthStartMs, -back);
    const end = back === 0 ? input.nowMs : shiftMonths(monthStartMs, -back + 1);
    const spanDays = Math.max(1, Math.floor((end - start) / DAY_MS));
    for (let k = 0; k < base[i]!; k++) {
      const day = start + Math.floor(input.rng() * spanDays) * DAY_MS + DAY_MS / 2;
      out.push(clampPast(businessHourMs(day, input.rng), input.nowMs));
    }
  }
  return out.sort((a, b) => a - b);
}

function shiftMonths(monthStartMs: number, delta: number): number {
  const d = new Date(monthStartMs + DAY_MS / 2);
  return trDayStartMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1, 12));
}

/** `baseMs`'den `minDays`–`maxDays` gün sonra, mesai saatinde; asla gelecekte değil ve asla `baseMs`'den önce değil. */
export function after(baseMs: number, minDays: number, maxDays: number, nowMs: number, rng: Rng): number {
  const days = minDays + rng() * Math.max(0, maxDays - minDays);
  const candidate = businessHourMs(baseMs + days * DAY_MS, rng);
  const lower = baseMs + 60_000;
  return Math.max(lower, clampPast(candidate, nowMs));
}

/** Bugünden `dayOffset` gün sonra (eksi = geçmiş) TR saatinde an — randevu/görev vadesi için (gelecek SERBEST). */
export function dayAt(nowMs: number, dayOffset: number, hour: number, minute = 0): number {
  return trDayStartMs(nowMs + dayOffset * DAY_MS) + hour * 3_600_000 + minute * 60_000;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
export const dateKeyOf = (ms: number): string => trDayKey(ms);

/** Bulunulan aydan `monthsBack` ay önceki ayın 1'i (`YYYY-MM-01`, TR). */
export function monthKey(nowMs: number, monthsBack: number): string {
  const { monthStartMs } = monthInfo(nowMs);
  return trDayKey(shiftMonths(monthStartMs, -monthsBack) + DAY_MS / 2).slice(0, 8) + "01";
}

/** Bu ay oluşturulan kayıtların payı (test/rapor yardımcısı). */
export function shareInCurrentMonth(stamps: readonly number[], nowMs: number): number {
  if (stamps.length === 0) return 0;
  const { monthStartMs } = monthInfo(nowMs);
  return stamps.filter((s) => s >= monthStartMs).length / stamps.length;
}
