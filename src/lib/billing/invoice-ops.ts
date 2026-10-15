/** Fatura/ödeme işlemleri için saf doğrulama yardımcıları (sunucu ve test ortak). */

/**
 * Elle tahsilat işaretleme yöntemleri (yalnız platform yöneticisi). Ürün kararı (2026-10-12): abonelik/paket ödemesi
 * YALNIZ kredi kartıyla alınır — havale/EFT ve nakit ile üyelik yoktur; bu liste yalnız kartla elle tahsilat ve düzeltme içindir.
 */
export const MANUAL_PAYMENT_METHODS = [
  { value: "kart_pos", label: "Kredi kartı (POS, elle)" },
  { value: "diger", label: "Yönetici düzeltmesi" },
] as const;

/** Geçmiş kayıtlarda kalan eski yöntemler: yalnız OKUMA/raporlama için tanınır, yeni kayıtta seçilemez. */
export const LEGACY_MANUAL_PAYMENT_METHODS = [
  { value: "havale", label: "Havale / EFT (eski kayıt)" },
  { value: "nakit", label: "Nakit (eski kayıt)" },
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number]["value"];

export const MAX_MONEY_TRY = 10_000_000;

/** "1.234,56" veya "1234.56" -> 1234.56; negatif, sıfır, 2'den fazla ondalık ve aşırı değer null. */
export function parseMoneyTry(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, "").replace(/₺|TRY|TL/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MONEY_TRY) return null;
  return Math.round(n * 100) / 100;
}

/** Boş tutar = tam fatura tutarı. Kısmi iade serbest ama toplamı aşamaz. */
export function validateRefundAmount(raw: string, invoiceTotal: number): { value: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { value: Math.round(invoiceTotal * 100) / 100 };
  const n = parseMoneyTry(text);
  if (n === null) return { error: "İade tutarı geçersiz (pozitif, en fazla 2 ondalık)." };
  if (n > invoiceTotal + 0.01) return { error: "İade tutarı fatura tutarını aşamaz." };
  return { value: n };
}

/** "Ödendi olarak işaretle" yalnız kesilmiş ve ödenmemiş faturada (SK6/B169): kesilmemiş taslak ödenemez. */
export const MARK_PAID_STATUSES = ["open", "uncollectible"] as const;

/**
 * Elle ödeme tarihi KATI doğrulama (SK6/B169; arayüzdeki `max={today}` sunucuda da geçerli):
 *  - biçim YYYY-MM-DD ve gidiş-dönüş eşleşmesi (2026-02-31 → 2026-03-03 olmaz; 2026-13-01 reddedilir);
 *  - İstanbul gününe göre bugünden ileri olamaz;
 *  - fatura kesim gününden (`issuedKey`, İstanbul günü) önce olamaz.
 * Boş metin = tarih verilmedi (çağıran "şimdi" kullanır).
 */
export function validatePaidDate(
  raw: string,
  opts: { todayKey: string; issuedKey: string | null },
): { ok: true; dateKey: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, dateKey: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: "Geçersiz ödeme tarihi (GG.AA.YYYY takvim günü seçin)." };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, error: "Geçersiz ödeme tarihi: takvimde olmayan gün." };
  if (s > opts.todayKey) return { ok: false, error: "Ödeme tarihi bugünden ileri olamaz." };
  if (opts.issuedKey && s < opts.issuedKey) {
    return { ok: false, error: `Ödeme tarihi faturanın kesim tarihinden (${opts.issuedKey.split("-").reverse().join(".")}) önce olamaz.` };
  }
  return { ok: true, dateKey: s };
}
