/**
 * TCMB EVDS saf yardımcıları (ağ/DB yok; birim testli). Sunucu çekimi: `evds.ts`.
 */

export type EvdsPoint = {
  /** Aylık seri: "YYYY-MM"; haftalık/günlük seri: "YYYY-MM-DD". */
  period: string;
  value: number;
};

/** EVDS yanıt alanı adı: seri kodundaki noktalar alt çizgi olur (TP.FG.J0 → TP_FG_J0). */
export function evdsFieldName(seriesCode: string): string {
  return seriesCode.replace(/\./g, "_");
}

/** EVDS "Tarih" değerini normalleştirir: "2025-9" → "2025-09"; "06-10-2025" → "2025-10-06"; "2025-10-06" aynen. */
export function normalizeEvdsDate(raw: string): string | null {
  const t = raw.trim();
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, "0")}` : null;
  }
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12
      ? `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? t : null;
}

/** EVDS JSON gövdesini (`{ items: [...] }`) eskiden yeniye noktalara çevirir. Bozuk/boş değerler atlanır; hiç nokta yoksa null. */
export function parseEvdsItems(body: unknown, seriesCode: string): EvdsPoint[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const field = evdsFieldName(seriesCode);
  const points: EvdsPoint[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tarih = rec["Tarih"];
    const raw = rec[field];
    if (typeof tarih !== "string" && typeof tarih !== "number") continue;
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const period = normalizeEvdsDate(String(tarih));
    if (!period) continue;
    points.push({ period, value });
  }
  if (points.length === 0) return null;
  return points.sort((a, b) => a.period.localeCompare(b.period));
}

/** Son (en yeni dönemli) nokta. */
export function latestPoint(points: readonly EvdsPoint[] | null): EvdsPoint | null {
  return points && points.length > 0 ? points[points.length - 1]! : null;
}

/** Yıllık yüzde faizi aylık orana çevirir (yıllık / 12, 2 hane). Geçersiz/≤0 → null. */
export function annualToMonthlyPct(annualPct: number): number | null {
  if (!Number.isFinite(annualPct) || annualPct <= 0) return null;
  return Math.round((annualPct / 12) * 100) / 100;
}

function shiftMonth(key: string, delta: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/**
 * TÜİK yöntemi: 12 aylık ortalama TÜFE değişimi (%) = son 12 ay endeks ortalaması / önceki 12 ay ortalaması − 1.
 * `indexByMonth` anahtarı "YYYY-MM". Bir ay için 24 ardışık endeks yoksa o ay HESAPLANMAZ (eksik veriyle tahmin yok).
 */
export function tufe12mAverageChange(indexByMonth: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const month of Object.keys(indexByMonth)) {
    let cur = 0;
    let prev = 0;
    let ok = true;
    for (let i = 0; i < 12 && ok; i += 1) {
      const a = indexByMonth[shiftMonth(month, -i)];
      const b = indexByMonth[shiftMonth(month, -12 - i)];
      if (!(typeof a === "number" && a > 0 && typeof b === "number" && b > 0)) ok = false;
      else {
        cur += a;
        prev += b;
      }
    }
    if (!ok) continue;
    out[month] = Math.round(((cur / prev - 1) * 100) * 100) / 100;
  }
  return out;
}
