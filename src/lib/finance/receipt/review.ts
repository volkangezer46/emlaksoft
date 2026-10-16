/**
 * İnceleme ekranının SAF mantığı (istemci + test): okunan alanlardan düzenlenebilir taslak, "Kayda aktar" çıktısı ve
 * yapay zekânın kendiliğinden istenip istenmeyeceği. Kayıt AÇMAZ; yalnız formu dolduracak değerleri üretir.
 */
import type { ReceiptExtraction, ReceiptFields } from "./types";

export const REVIEW_VAT_RATES = [0, 1, 10, 20] as const;

export type ReviewDraft = {
  amount: string;
  date: string;
  vatRate: number | null;
  vendor: string;
  taxId: string;
  documentNo: string;
  /** Alan bazında "kullan" onayı (düşük güvenli alan varsayılan olarak işaretsiz gelir). */
  use: { amount: boolean; date: boolean; vatRate: boolean; vendor: boolean; documentNo: boolean; category: boolean; party: boolean };
};

export type ReviewApply = {
  amount: number | null;
  date: string | null;
  vatRate: number | null;
  vendor: string | null;
  partyId: string | null;
  category: string | null;
  title: string | null;
};

const LOW = 0.5;

export function formatAmountTr(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tek oranlı belgede o oran; çok oranlıda en yüksek matrahlı oran (kayıt tek oran taşır, kullanıcı uyarılır). */
export function primaryVatRate(f: ReceiptFields): number | null {
  const lines = f.vatLines?.value ?? [];
  if (!lines.length) return null;
  const pick = lines.length === 1 ? lines[0]! : [...lines].sort((a, b) => (b.base ?? b.amount ?? 0) - (a.base ?? a.amount ?? 0))[0]!;
  return (REVIEW_VAT_RATES as readonly number[]).includes(pick.rate) ? pick.rate : null;
}

export function draftFromExtraction(x: ReceiptExtraction): ReviewDraft {
  const f = x.fields;
  const vat = primaryVatRate(f);
  return {
    amount: f.total ? formatAmountTr(f.total.value) : "",
    date: f.date?.value ?? "",
    vatRate: vat,
    vendor: x.party?.name ?? f.sellerName?.value ?? "",
    taxId: f.sellerTaxId?.value ?? "",
    documentNo: f.documentNo?.value ?? "",
    use: {
      amount: !!f.total && f.total.confidence >= LOW,
      date: !!f.date && f.date.confidence >= LOW,
      vatRate: vat != null && (f.vatLines?.confidence ?? 0) >= LOW && (f.vatLines?.value.length ?? 0) === 1,
      vendor: !!(x.party || (f.sellerName && f.sellerName.confidence >= LOW)),
      documentNo: !!f.documentNo && f.documentNo.confidence >= LOW,
      category: !!x.category && x.category.confidence >= 0.6,
      party: !!x.party && x.party.confidence >= 0.75,
    },
  };
}

/** "1.250,50" / "1250.5" → sayı (pozitif); geçersizse null. */
export function parseDraftAmount(s: string): number | null {
  const t = s.replace(/[^\d.,]/g, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  let norm = t;
  if (lastComma > lastDot) norm = t.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) norm = t.replace(/,/g, "");
  else if (lastDot >= 0 && t.length - lastDot - 1 === 3 && (t.match(/\./g)?.length ?? 0) >= 1) norm = t.replace(/\./g, "");
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 && n < 10_000_000_000 ? Math.round(n * 100) / 100 : null;
}

export function applyFromDraft(d: ReviewDraft, x: ReceiptExtraction): ReviewApply {
  const vendor = d.use.vendor && d.vendor.trim() ? d.vendor.trim().slice(0, 120) : null;
  const no = d.use.documentNo && d.documentNo.trim() ? d.documentNo.trim().slice(0, 30) : null;
  const docLabel = x.fields.docType?.value === "okc_fis" ? "Fiş" : "Fatura";
  const title = vendor ? `${vendor}${no ? ` · ${docLabel} ${no}` : ""}`.slice(0, 160) : no ? `${docLabel} ${no}` : null;
  return {
    amount: d.use.amount ? parseDraftAmount(d.amount) : null,
    date: d.use.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null,
    vatRate: d.use.vatRate ? d.vatRate : null,
    vendor,
    partyId: d.use.party && x.party ? x.party.id : null,
    category: d.use.category && x.category ? x.category.value : null,
    title,
  };
}

/** Yerel sonuç eksik ya da zayıfsa (ve yapay zekâ açık + tanımlıysa) istemci yapay zekâyı kendiliğinden ister. */
export function shouldAutoRunAi(x: ReceiptExtraction): boolean {
  if (x.ai !== "available") return false;
  const f = x.fields;
  if (f.total?.source === "karekod" || f.total?.source === "xml") return !f.sellerName && !x.party;
  return !f.total || f.total.confidence < 0.85 || !f.date || f.date.confidence < 0.8 || !f.sellerName || f.sellerName.confidence < 0.7;
}
