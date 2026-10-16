/**
 * Ofis "Vergi / TC no" alanı (SAF). Boşluk, nokta ve tire atılır; boş değer serbesttir (alan isteğe bağlı), dolu değer
 * yalnız 10 hane (VKN) ya da 11 hane (TCKN) olabilir. Sağlama (checksum) burada ZORUNLU DEĞİL: mevcut kayıtlar
 * yanlış hane yüzünden diğer alanları kaydedemez hale gelmesin; biçim kapısı ödeme adımındaki belirsiz hatayı önler.
 */
export const TAX_NUMBER_ERROR = "Vergi / TC no 10 haneli vergi numarası ya da 11 haneli TC kimlik numarası olmalı.";

export function normalizeTaxNumber(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = String(raw ?? "").replace(/[\s.\-]/g, "");
  if (!value) return { ok: true, value: null };
  if (!/^\d{10,11}$/.test(value)) return { ok: false, error: TAX_NUMBER_ERROR };
  return { ok: true, value };
}
