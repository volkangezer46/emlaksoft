/**
 * Beklenen kapanış tarihi (SAF). Girdi `<input type="date">` değeri (YYYY-AA-GG) ya da boş (temizle).
 * Tarih 2000 ile 2100 arasında olmalı; geçmiş tarih kabul edilir (gecikmiş kapanış uyarısı bundan üretilir).
 */
export type ExpectedCloseParse = { ok: true; value: string | null } | { ok: false; error: string };

export function parseExpectedCloseDate(raw: string): ExpectedCloseParse {
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: "Geçerli bir tarih seçin." };
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { ok: false, error: "Geçerli bir tarih seçin." };
  if (y < 2000 || y > 2100) return { ok: false, error: "Tarih 2000 ile 2100 arasında olmalı." };
  return { ok: true, value: v };
}

/** Bugüne göre durum: "gecikti" (geçmiş), "yakin" (7 gün içinde), "ileride"; tarih yoksa null. */
export function expectedCloseStatus(date: string | null | undefined, todayKey: string): "gecikti" | "yakin" | "ileride" | null {
  if (!date) return null;
  if (date < todayKey) return "gecikti";
  const [y, m, d] = todayKey.split("-").map(Number);
  const week = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  return date <= week ? "yakin" : "ileride";
}
