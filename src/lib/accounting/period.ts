/**
 * Muhasebe dönem çözümleyicisi (SAF: sunucu/istemci ortak, DB yok).
 * Dönem sınırları Türkiye takvimine göredir (`clock.ts` trMonth* yardımcıları): UTC sunucuda
 * ayın ilk 3 saati önceki aya yazılmaz. Üst sınır HER ZAMAN hariçtir (`< toIso`).
 */
import { TR_OFFSET_MS, DAY_MS, trMonthStartMs, trMonthKey } from "@/lib/clock";

export type PeriodPreset = "bu-ay" | "gecen-ay" | "ozel" | "tumu";

export type Period = {
  preset: PeriodPreset;
  /** Dahil alt sınır (ISO, UTC) ya da null (sınırsız). */
  fromIso: string | null;
  /** HARİÇ üst sınır (ISO, UTC) ya da null (sınırsız). */
  toIso: string | null;
  /** Özel aralık için TR gün anahtarları (alt dahil, üst dahil). Form alanlarını doldurmak için. */
  fromDay: string | null;
  toDay: string | null;
  label: string;
};

export type PeriodParams = { donem?: string; from?: string; to?: string };

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-AA-GG" gerçek bir takvim günüyse TR gün başlangıcı (epoch ms), değilse null. */
export function trDayStartFromKey(key: string | undefined): number | null {
  const m = DAY_RE.exec((key ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return utc - TR_OFFSET_MS;
}

function dayKeyOf(ms: number): string {
  return new Date(ms + TR_OFFSET_MS).toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

function monthLabel(ms: number): string {
  const key = trMonthKey(ms);
  const [y, m] = key.split("-");
  return `${MONTHS_TR[Number(m) - 1] ?? m} ${y}`;
}

/** Sorgu parametrelerinden dönemi çözer. Geçersiz/eksik değer güvenli varsayılana (bu ay) düşer. */
export function resolvePeriod(params: PeriodParams, nowMs: number): Period {
  const preset = (params.donem ?? "").trim();

  if (preset === "tumu") {
    return { preset: "tumu", fromIso: null, toIso: null, fromDay: null, toDay: null, label: "Tüm zamanlar" };
  }

  if (preset === "gecen-ay") {
    const from = trMonthStartMs(nowMs, -1);
    const to = trMonthStartMs(nowMs, 0);
    return {
      preset: "gecen-ay",
      fromIso: new Date(from).toISOString(),
      toIso: new Date(to).toISOString(),
      fromDay: null,
      toDay: null,
      label: monthLabel(from),
    };
  }

  if (preset === "ozel") {
    let from = trDayStartFromKey(params.from);
    let toStart = trDayStartFromKey(params.to);
    if (from !== null || toStart !== null) {
      if (from !== null && toStart !== null && from > toStart) [from, toStart] = [toStart, from];
      const toExclusive = toStart !== null ? toStart + DAY_MS : null;
      const fromDay = from !== null ? dayKeyOf(from) : null;
      const toDay = toStart !== null ? dayKeyOf(toStart) : null;
      return {
        preset: "ozel",
        fromIso: from !== null ? new Date(from).toISOString() : null,
        toIso: toExclusive !== null ? new Date(toExclusive).toISOString() : null,
        fromDay,
        toDay,
        label: `${fromDay ? dayLabel(fromDay) : "…"} – ${toDay ? dayLabel(toDay) : "…"}`,
      };
    }
    // iki uç da geçersiz: bu aya düş
  }

  const from = trMonthStartMs(nowMs, 0);
  const to = trMonthStartMs(nowMs, 1);
  return {
    preset: "bu-ay",
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    fromDay: null,
    toDay: null,
    label: monthLabel(from),
  };
}

/** Dönemi URL parametrelerine çevirir (bağlantı kurmak için; bu-ay varsayılan olduğundan yine de açık yazılır). */
export function periodSearchParams(period: Period): Record<string, string> {
  const out: Record<string, string> = { donem: period.preset };
  if (period.preset === "ozel") {
    if (period.fromDay) out.from = period.fromDay;
    if (period.toDay) out.to = period.toDay;
  }
  return out;
}

/** ISO an dönemin içinde mi? (alt dahil, üst hariç; null sınır = sınırsız). Değer yoksa false. */
export function inPeriod(iso: string | null | undefined, period: Pick<Period, "fromIso" | "toIso">): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  if (period.fromIso && t < Date.parse(period.fromIso)) return false;
  if (period.toIso && t >= Date.parse(period.toIso)) return false;
  return true;
}
