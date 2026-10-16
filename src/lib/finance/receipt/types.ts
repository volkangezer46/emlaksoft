/**
 * Akıllı fiş/fatura okuma (FN5+) — ortak tipler (SAF; istemci ve sunucu paylaşır).
 *
 * Katmanlar (önce kesin/yerel, en son yapay zekâ): GİB karekodu → UBL-TR XML → PDF metin katmanı → görsel OCR (yerel
 * Tesseract) → yapay zekâ (yalnız ayrı açık onayla). Her alan değeriyle birlikte GÜVEN (0..1) ve KAYNAK taşır. Sonuç
 * YALNIZ ÖNERİDİR: kullanıcı inceleyip "Kayda aktar" deyip formu kaydetmeden hiçbir kayıt açılmaz.
 */

export type ReceiptSource = "karekod" | "xml" | "pdf-text" | "ocr" | "ai";

/** Birleştirme önceliği: soldaki kazanır (aynı güven bandında). */
export const SOURCE_PRECEDENCE: readonly ReceiptSource[] = ["karekod", "xml", "pdf-text", "ocr", "ai"];

export const SOURCE_LABEL: Record<ReceiptSource, string> = {
  karekod: "Karekod",
  xml: "e-Fatura XML",
  "pdf-text": "PDF metni",
  ocr: "Görsel okuma",
  ai: "Yapay zekâ",
};

export type ReceiptDocType = "okc_fis" | "e_fatura" | "e_arsiv" | "fatura" | "makbuz" | "smm" | "dekont" | "diger";

export const DOC_TYPE_LABEL: Record<ReceiptDocType, string> = {
  okc_fis: "ÖKC fişi",
  e_fatura: "e-Fatura",
  e_arsiv: "e-Arşiv fatura",
  fatura: "Fatura",
  makbuz: "Makbuz",
  smm: "Serbest meslek makbuzu",
  dekont: "Banka dekontu",
  diger: "Diğer belge",
};

export type PaymentMethod = "nakit" | "kart" | "havale" | "diger";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { nakit: "Nakit", kart: "Kart", havale: "Havale / EFT", diger: "Diğer" };

export type Field<T> = { value: T; confidence: number; source: ReceiptSource };

export type VatLine = { rate: number; base: number | null; amount: number | null };

export type LineItem = { name: string; quantity: number | null; total: number | null; vatRate: number | null };

export type ReceiptFields = {
  /** Ödenecek / genel toplam (KDV dahil, kesintiler düşülmüş). */
  total?: Field<number>;
  /** Vergiler dahil toplam (tevkifat öncesi); toplamdan farklıysa gösterilir. */
  grossTotal?: Field<number>;
  /** KDV matrahı toplamı (net). */
  net?: Field<number>;
  vatTotal?: Field<number>;
  vatLines?: Field<VatLine[]>;
  /** KDV tevkifatı tutarı. */
  vatWithholding?: Field<number>;
  /** Gelir vergisi stopajı tutarı (SMM, kira). */
  incomeTaxWithholding?: Field<number>;
  currency?: Field<string>;
  /** YYYY-MM-DD */
  date?: Field<string>;
  /** HH:MM */
  time?: Field<string>;
  docType?: Field<ReceiptDocType>;
  documentNo?: Field<string>;
  ettn?: Field<string>;
  sellerName?: Field<string>;
  sellerTaxId?: Field<string>;
  sellerTaxOffice?: Field<string>;
  buyerName?: Field<string>;
  buyerTaxId?: Field<string>;
  paymentMethod?: Field<PaymentMethod>;
  items?: Field<LineItem[]>;
  /** ÖKC: Z raporu numarası (fiş no ile birlikte mükerrer anahtarı). */
  zNo?: Field<string>;
};

export type ReceiptFieldKey = keyof ReceiptFields;

/** Tek bir katmanın ham çıktısı (birleştirmeden önce). */
export type LayerFields = Partial<ReceiptFields>;

export type LayerStatus = "done" | "empty" | "skipped" | "failed";
export type LayerReport = { source: ReceiptSource; status: LayerStatus; reason?: string; ms?: number };

export type ReceiptWarningCode =
  | "vkn_checksum"
  | "tckn_checksum"
  | "total_mismatch"
  | "vat_mismatch"
  | "future_date"
  | "old_date"
  | "conflict"
  | "foreign_currency"
  | "low_confidence"
  | "duplicate";

export type ReceiptWarning = { code: ReceiptWarningCode; field?: ReceiptFieldKey; message: string };

export type CategorySuggestion = { value: string; label: string; confidence: number; reason: "kural" | "gecmis" | "anahtar" };
export type PartySuggestion = { id: string; name: string; confidence: number; reason: "vkn" | "ad" };

export type DuplicateHit = {
  kind: "ettn" | "belge_no" | "tutar_tarih";
  attachmentId?: string;
  entryId?: string;
  label: string;
  href: string;
};

export type AiState = "off" | "available" | "done" | "unavailable" | "failed";

export type ReceiptExtraction = {
  version: 1;
  fields: ReceiptFields;
  layers: LayerReport[];
  warnings: ReceiptWarning[];
  category?: CategorySuggestion;
  party?: PartySuggestion;
  duplicates: DuplicateHit[];
  ai: AiState;
  /** ISO zaman damgası. */
  extractedAt: string;
};

/** Eski (FN5) öneri biçimi: fiş kutusu ve kayıt formu bunu okumaya devam eder. */
export type LegacySuggestion = { amount?: number; date?: string; vatRate?: 1 | 10 | 20; vendor?: string };

export function confidenceBand(c: number): "yuksek" | "orta" | "dusuk" {
  if (c >= 0.9) return "yuksek";
  if (c >= 0.7) return "orta";
  return "dusuk";
}

export const CONFIDENCE_LABEL = { yuksek: "Yüksek güven", orta: "Orta güven", dusuk: "Düşük güven" } as const;
