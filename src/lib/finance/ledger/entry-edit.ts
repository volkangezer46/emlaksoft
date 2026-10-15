/**
 * "Hareketi düzenle" penceresinin SAF mantığı (istemci + test; DOM/ağ/zaman yok). SK6/B101.
 *
 * Defter v2'de (`finance_update_entry_v2`) `amount` BELGE tutarıdır: KDV dahilse brüt, hariçse net; stopaj net üzerinden kesilir ve
 * hesaptan çıkan/giren nakit = brüt − stopaj. Satırdaki `amount` ise NAKİTTİR. Pencere bu yüzden belge tutarını nakitten geri kurar
 * (`documentAmountOf`) ve satırın `vat_included` / stopaj oranını geri gönderir; aksi halde stopajlı bir kayıtta yalnız "Kaydet"e
 * basmak nakdi değiştirirdi (ör. kasa 16.000 + stopaj 4.000 → belge 16.000 sayılır, nakit 12.800'e düşerdi).
 *
 * Geri kurulan değerler satırın nakdini BİREBİR üretmiyorsa (eski/eksik kayıt: stopaj tutarı var ama oranı yok ve oran tam
 * çıkarılamıyor) tutar/KDV/stopaj alanları kilitlenir ve yalnız açıklama alanları eski (v1) yolla güncellenir: nakit asla
 * kendiliğinden değişmez.
 */
import { parseMoneyInput } from "@/lib/money-input";
import { entryAmounts, splitVat } from "./vat";

export type EntryEditSource = {
  /** Satırdaki nakit tutar (cash_entries.amount). */
  amount: number;
  vatRate: number | null;
  vatAmount: number | null;
  /** null → bilinmiyor (DB varsayılanı true). */
  vatIncluded: boolean | null;
  withholdingRate: number | null;
  withholdingAmount: number | null;
};

export type EntryEditBaseline = {
  /** Belge tutarı (kullanıcının düzenlediği değer). */
  document: number;
  vatRate: number | null;
  vatIncluded: boolean;
  withholdingRate: number | null;
  /** false → tutar/KDV/stopaj salt okunur (nakit geri kurulamıyor). */
  monetaryEditable: boolean;
};

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const round2 = (n: number) => cents(n) / 100;

/** Belge tutarı: KDV dahil (ya da KDV bilinmiyor) → nakit + stopaj; KDV hariç → nakit + stopaj − KDV. */
export function documentAmountOf(src: EntryEditSource): number {
  const gross = round2(src.amount + (src.withholdingAmount ?? 0));
  if (src.vatRate !== null && src.vatIncluded === false) return round2(gross - (src.vatAmount ?? 0));
  return gross;
}

/** Stopaj oranı: satırda varsa o; yoksa tutardan (stopaj / net × 100) iki haneye; stopaj yoksa null. */
export function effectiveWithholdingRate(src: EntryEditSource): number | null {
  if (src.withholdingRate !== null) return src.withholdingRate;
  const wh = src.withholdingAmount ?? 0;
  if (wh <= 0) return null;
  const doc = documentAmountOf(src);
  const included = src.vatRate === null ? true : src.vatIncluded !== false;
  const net = splitVat(doc, src.vatRate ?? 0, included).net;
  if (net <= 0) return null;
  return Math.round((wh / net) * 100 * 100) / 100;
}

/** Pencerenin açılış değerleri; geri kurulan değerler nakdi birebir vermiyorsa tutar alanları kilitlenir. */
export function editBaseline(src: EntryEditSource): EntryEditBaseline {
  const document = documentAmountOf(src);
  const vatIncluded = src.vatRate === null ? true : src.vatIncluded !== false;
  const withholdingRate = effectiveWithholdingRate(src);
  const again = entryAmounts(document, src.vatRate, vatIncluded, withholdingRate);
  const monetaryEditable = cents(again.cash) === cents(src.amount) && cents(again.withheld ?? 0) === cents(src.withholdingAmount ?? 0);
  return { document, vatRate: src.vatRate, vatIncluded, withholdingRate, monetaryEditable };
}

export type EntryEditForm = {
  amount: string;
  date: string;
  category: string;
  title: string;
  counterparty: string;
  note: string;
  vatRate: number | null;
  vatIncluded: boolean;
  withholdingRate: number | null;
};

export type EntryEditValue = {
  amount: number;
  date: string;
  category: string;
  title: string;
  counterparty: string;
  note: string;
  vatRate: number | null;
  vatIncluded: boolean;
  withholdingRate: number | null;
  /** Hesaptan çıkan/giren nakit (önizleme ve kontrol). */
  cash: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { title: 160, counterparty: 120, note: 1000, max: 9_999_999_999.99 } as const;

/**
 * İstemci doğrulaması (sunucuya gitmeden, tek karede): tutar, tarih, kategori ve uzunluklar. Kural sunucu ile aynıdır
 * (parseEntryInput / updateEntryV2 / RPC); nihai karar yine RPC'dedir. `titleFallback` boş açıklamada kategori adıdır.
 */
export function validateEntryEdit(form: EntryEditForm, today: string, titleFallback: string): { ok: true; value: EntryEditValue } | { ok: false; error: string; field: keyof EntryEditForm } {
  const parsed = parseMoneyInput(form.amount, { max: LIMITS.max });
  if (!parsed.ok || parsed.value == null || parsed.value <= 0) return { ok: false, error: "Geçerli, en çok iki ondalık haneli bir tutar girin.", field: "amount" };
  if (!form.category) return { ok: false, error: "Ne için olduğunu seçin.", field: "category" };
  const date = form.date || today;
  if (!ISO.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return { ok: false, error: "Geçerli bir tarih girin.", field: "date" };
  }
  if (date > today) return { ok: false, error: "Tarih gelecekte olamaz.", field: "date" };
  if (date < "2000-01-01") return { ok: false, error: "Tarih çok eski.", field: "date" };
  const title = form.title.trim() || titleFallback;
  if (title.length > LIMITS.title) return { ok: false, error: `Açıklama en fazla ${LIMITS.title} karakter olabilir.`, field: "title" };
  if (form.counterparty.trim().length > LIMITS.counterparty) return { ok: false, error: `Karşı taraf en fazla ${LIMITS.counterparty} karakter olabilir.`, field: "counterparty" };
  if (form.note.trim().length > LIMITS.note) return { ok: false, error: `Not en fazla ${LIMITS.note} karakter olabilir.`, field: "note" };
  const amounts = entryAmounts(parsed.value, form.vatRate, form.vatRate === null ? true : form.vatIncluded, form.withholdingRate);
  if (amounts.cash < 0.01) return { ok: false, error: "Stopaj sonrası hesaba yansıyan tutar sıfırdan büyük olmalı.", field: "amount" };
  return {
    ok: true,
    value: {
      amount: parsed.value,
      date,
      category: form.category,
      title,
      counterparty: form.counterparty.trim(),
      note: form.note.trim(),
      vatRate: form.vatRate,
      vatIncluded: form.vatRate === null ? true : form.vatIncluded,
      withholdingRate: form.withholdingRate,
      cash: amounts.cash,
    },
  };
}

/**
 * `updateEntryV2` yaması: belge tutarı + satırın KDV dahil/hariç bilgisi + KDV ve stopaj oranı her zaman birlikte gider
 * (RPC `amount` gelince `vat_included`'ı yamadan okur; eksik gönderilirse true varsayar).
 */
export function entryV2Patch(v: EntryEditValue) {
  return {
    amount: v.amount,
    vatIncluded: v.vatIncluded,
    vatRate: v.vatRate,
    withholdingRate: v.withholdingRate,
    entryDate: v.date,
    category: v.category,
    title: v.title,
    counterparty: v.counterparty,
    note: v.note,
  };
}
