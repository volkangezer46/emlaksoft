import { financeHref } from "@/lib/finance/routes";

/**
 * Genel bakış zeka kartlarının (Dikkat edilmesi gerekenler, Ay sonu kapanışı) hedef adresleri — TEK kaynak.
 * Her adres hedef sekmenin GERÇEKTEN okuduğu süzgeçleri taşır (Hareketler: `_hareketler/ledger-filters.ts`), böylece
 * karttaki sayı tıklanınca aynı küme açılır (sıfır çıkmaz metrik). Sözleşme testi: insight-links.test.ts.
 */

/** "YYYY-MM" ayının ilk ve son günü. */
export function monthRange(monthKey: string): { from: string; to: string } {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, "0")}` };
}

const CATEGORY_RE = /^[a-z0-9_]{1,60}$/;
/** finance_pnl kategorisiz satırları bu anahtarla toplar; Hareketler'de karşılığı olan bir kategori değildir. */
const PNL_UNCATEGORIZED = new Set(["diger_gider", "diger_gelir"]);

export const insightLinks = {
  /** Kategori gideri (bu ay): kategorisi süzülebiliyorsa o kategori, değilse tüm giderler. */
  categoryExpenses(category: string, from: string, to: string): string {
    const kategori = CATEGORY_RE.test(category) && !PNL_UNCATEGORIZED.has(category) ? category : null;
    return financeHref("hareketler", { tur: "gider", kategori, from, to });
  },
  /** Mükerrer ödeme şüphesi: aynı tarih aralığında karşı taraf/açıklama araması. */
  duplicate(q: string, from: string, to: string): string {
    return financeHref("hareketler", { tur: "gider", q: q || null, from, to });
  },
  receiptless(from: string, to: string): string {
    return financeHref("hareketler", { tur: "gider", belge: "yok", from, to });
  },
  /** Tek banka hesabı varsa o hesabın eşleşmemiş hareketleri; birden çoksa Kasa ve banka (mutabakat kuyruğu). */
  unreconciled(bankIds: readonly string[], from: string, to: string): string {
    return bankIds.length === 1 ? financeHref("hareketler", { hesap: bankIds[0], mutabik: "hayir", from, to }) : financeHref("kasa-banka");
  },
  noVat(from: string, to: string): string {
    return financeHref("hareketler", { kdv: "yok", from, to });
  },
  vatYear(year: string): string {
    return financeHref("vergi", { yil: year });
  },
  periodLock(): string {
    return `${financeHref("ayarlar")}#donem`;
  },
  review(): string {
    return financeHref("kasa-banka");
  },
} as const;
