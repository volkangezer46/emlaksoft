export const EXPENSE_INPUT_LIMITS = {
  title: 160,
  notes: 2_000,
  category: 60,
  amountTry: 9_999_999_999.99,
  receiptUrl: 500,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORY_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const AMOUNT_RE = /^(?:0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ExpenseInput = {
  title: string;
  amount: number;
  category: string;
  expenseDate: string;
  notes: string | null;
  propertyId: string | null;
  /** Fiş/fatura bağlantısı (yalnız https; e-Arşiv, bulut klasörü vb.). */
  receiptUrl: string | null;
};

/** Fiş bağlantısı doğrulaması: yalnız https, kimlik bilgisi içermeyen, makul uzunlukta URL. */
export function parseReceiptUrl(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > EXPENSE_INPUT_LIMITS.receiptUrl) return { ok: false, error: "Fiş bağlantısı çok uzun." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Fiş bağlantısı geçerli bir adres olmalı (https://…)." };
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return { ok: false, error: "Fiş bağlantısı https:// ile başlamalı." };
  }
  return { ok: true, value: url.toString() };
}

export type ExpenseInputResult =
  | { ok: true; value: ExpenseInput }
  | { ok: false; error: string };

export function isExpenseId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function isCalendarDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseExpenseForm(
  formData: FormData,
  defaultDate = new Date().toISOString().slice(0, 10),
): ExpenseInputResult {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Başlık zorunludur." };
  if (title.length > EXPENSE_INPUT_LIMITS.title) {
    return { ok: false, error: `Başlık en fazla ${EXPENSE_INPUT_LIMITS.title} karakter olabilir.` };
  }

  const rawAmount = String(formData.get("amount") ?? "").trim();
  if (!AMOUNT_RE.test(rawAmount)) {
    return { ok: false, error: "Tutar pozitif ve en fazla iki ondalık basamaklı olmalıdır." };
  }
  const amount = Number(rawAmount.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > EXPENSE_INPUT_LIMITS.amountTry) {
    return { ok: false, error: "Geçerli tutar aralığı 0,01–9.999.999.999,99 TRY'dir." };
  }

  const category = String(formData.get("category") ?? "diger").trim();
  if (!category || category.length > EXPENSE_INPUT_LIMITS.category || !CATEGORY_RE.test(category)) {
    return { ok: false, error: "Geçerli bir gider kategorisi seçin." };
  }

  const expenseDate = String(formData.get("expense_date") ?? "").trim() || defaultDate;
  if (!isCalendarDate(expenseDate)) {
    return { ok: false, error: "Geçerli bir gider tarihi girin." };
  }

  const rawNotes = String(formData.get("notes") ?? "").trim();
  if (rawNotes.length > EXPENSE_INPUT_LIMITS.notes) {
    return { ok: false, error: `Not en fazla ${EXPENSE_INPUT_LIMITS.notes} karakter olabilir.` };
  }

  const rawPropertyId = String(formData.get("property_id") ?? "").trim();
  if (rawPropertyId && !isExpenseId(rawPropertyId)) {
    return { ok: false, error: "Seçilen portföy geçersiz." };
  }

  const receipt = parseReceiptUrl(String(formData.get("receipt_url") ?? ""));
  if (!receipt.ok) return { ok: false, error: receipt.error };

  return {
    ok: true,
    value: {
      title,
      amount,
      category,
      expenseDate,
      notes: rawNotes || null,
      propertyId: rawPropertyId || null,
      receiptUrl: receipt.value,
    },
  };
}
