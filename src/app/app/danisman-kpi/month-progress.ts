/**
 * Dönem ilerlemesi ve geçen aya göre tempo — saf hesaplar (zaman dışarıdan verilir,
 * `Date.now()` yok; çağıran `@/lib/clock` `now()` geçirir).
 */

/** Dönemin yüzde kaçının geçtiği (0-100, tam sayı). Geçersiz aralıkta null (sahte yüzde yok). */
export function monthElapsedPct(nowMs: number, startMs: number, endMs: number): number | null {
  if (![nowMs, startMs, endMs].every(Number.isFinite) || endMs <= startMs) return null;
  const pct = ((nowMs - startMs) / (endMs - startMs)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export type PaceGauge = {
  /** Gösterge değeri ve ölçeği (aynı birim: puan). */
  value: number;
  max: number;
  /** Geçen ayın değeri (halkada hedef çentiği). */
  target: number;
  /** Bu ay / geçen ay, tam sayı yüzde (taşabilir, ör. 130). */
  ratioPct: number;
};

/**
 * "Bu ay vs geçen ay" göstergesi. Geçen ay 0 ya da değerler geçersizse null:
 * oran tanımsızdır, sahte gösterge çizilmez.
 */
export function paceGauge(current: number, previous: number): PaceGauge | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0 || current < 0) return null;
  return { value: current, max: Math.max(current, previous), target: previous, ratioPct: Math.round((current / previous) * 100) };
}

/**
 * Tempo yorumu: ay ilerlemesine göre beklenen değer = geçen ay × geçen süre oranı.
 * "ahead" beklenenin üstünde, "behind" %10'dan fazla altında, aksi "on-track".
 * Ay ilerlemesi bilinmiyorsa null.
 */
export function paceVerdict(current: number, previous: number, elapsedPct: number | null): "ahead" | "on-track" | "behind" | null {
  if (elapsedPct === null || !Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const expected = previous * (elapsedPct / 100);
  if (current >= expected) return "ahead";
  return current >= expected * 0.9 ? "on-track" : "behind";
}
