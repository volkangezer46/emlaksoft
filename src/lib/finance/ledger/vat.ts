/**
 * KDV ve stopaj hesabı (SAF; DOM/ağ/zaman yok). DB'deki `finance_vat_split` / `finance_entry_amounts` ile BİREBİR aynı sonucu
 * verir (finance-ledger-v2-sql-exec testi karşılaştırır). Yuvarlama `invoice-math.ts`'teki gibi kuruşa, yarım yukarı; kayan nokta
 * hatası olmasın diye hesap kuruş (tamsayı) üzerinden yapılır.
 *
 * Kavramlar:
 *  - Belge tutarı: kullanıcının yazdığı tutar. `included` (KDV dahil) ise brüt, değilse net (KDV hariç) kabul edilir.
 *  - Stopaj (ör. kira %20): KDV hariç net üzerinden kesilir; hesaptan çıkan/giren nakit = brüt − stopaj.
 */
import { round2 } from "@/lib/integrations/einvoice/invoice-math";

/** Seçicideki KDV oranları (sözleşme: %1 / %10 / %20; 0 = KDV'siz). */
export const LEDGER_VAT_RATES = [0, 1, 10, 20] as const;
/** Kira ödemesinde önerilen stopaj oranı. */
export const RENT_WITHHOLDING_RATE = 20;

export type VatSplit = { net: number; vat: number; gross: number };
export type WithholdingResult = { withheld: number; net: number };
export type EntryAmounts = {
  net: number;
  /** KDV oranı bilinmiyorsa null (eski kayıtlar için sahte KDV üretilmez). */
  vat: number | null;
  gross: number;
  /** Stopaj oranı yoksa null. */
  withheld: number | null;
  /** Hesaptan çıkan / hesaba giren nakit. */
  cash: number;
};

const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const rateBp = (rate: number) => Math.round(rate * 100);

function validAmount(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}
function validRate(r: number): boolean {
  return Number.isFinite(r) && r >= 0 && r <= 100;
}

/**
 * KDV ayrıştırma. `included` → brüt sabit, net = round(brüt × 100 / (100 + oran)), KDV = brüt − net.
 * `!included` → net sabit, KDV = round(net × oran / 100), brüt = net + KDV.
 */
export function splitVat(amount: number, rate: number, included: boolean): VatSplit {
  if (!validAmount(amount) || !validRate(rate)) return { net: 0, vat: 0, gross: 0 };
  const cents = toCents(amount);
  const bp = rateBp(rate);
  if (included) {
    const net = Math.round((cents * 10000) / (10000 + bp));
    return { net: net / 100, vat: (cents - net) / 100, gross: cents / 100 };
  }
  const vat = Math.round((cents * bp) / 10000);
  return { net: cents / 100, vat: vat / 100, gross: (cents + vat) / 100 };
}

/** Stopaj: `gross` (stopaj matrahı, KDV hariç tutar) × oran / 100; kalan = matrah − stopaj. */
export function withholding(gross: number, rate: number): WithholdingResult {
  if (!validAmount(gross) || !validRate(rate)) return { withheld: 0, net: round2(Math.max(0, gross || 0)) };
  const cents = toCents(gross);
  const withheld = Math.round((cents * rateBp(rate)) / 10000);
  return { withheld: withheld / 100, net: (cents - withheld) / 100 };
}

/**
 * Hareket tutarları (DB `finance_entry_amounts` ile aynı): KDV oranı null ise KDV bilinmiyor, belge tutarı brüt sayılır.
 * Stopaj net üzerinden kesilir; nakit = brüt − stopaj.
 */
export function entryAmounts(amount: number, vatRate: number | null, included: boolean, withholdingRate: number | null): EntryAmounts {
  const split = splitVat(amount, vatRate ?? 0, vatRate === null ? true : included);
  const wh = withholdingRate === null ? null : withholding(split.net, withholdingRate).withheld;
  const cash = (toCents(split.gross) - toCents(wh ?? 0)) / 100;
  return { net: split.net, vat: vatRate === null ? null : split.vat, gross: split.gross, withheld: wh, cash };
}
