import { financePath } from "@/lib/finance/routes";

/**
 * "Masraf bildir" (WP2) — SAF kurallar (istemci + sunucu + test). Ofis defterine kayıt yetkisi olmayan danışman iş
 * masrafını fiş fotoğrafıyla bildirir; talep /app/onaylar'a düşer, onaylanınca danışmana ÖDENECEK açık kalem olarak
 * deftere işlenir (DB: 20261023040001 expense_claim_submit + expense_claim_on_decision). Bu dosya DB/ağ/saat bilmez.
 */

/** Form ve "Masraflarım" listesi. */
export const EXPENSE_CLAIM_HREF = `${financePath("kayit")}/masraf`;

/** Tek talebin sayfası (fiş önizlemesi + durum); onay satırının açıklaması bu adresi taşır. */
export function expenseClaimPath(claimId: string): string {
  return `${EXPENSE_CLAIM_HREF}/${encodeURIComponent(claimId)}`;
}

export const EXPENSE_CLAIM_BUCKET = "expense-claims";

/** Kategori anahtarları gider yönü hareket kategorileriyle aynıdır (categories.ts CASH_CATEGORIES; DB CHECK birebir). */
export const EXPENSE_CLAIM_CATEGORIES = [
  { value: "ulasim", label: "Ulaşım (yakıt, taksi, otopark)" },
  { value: "reklam", label: "Reklam ve tanıtım" },
  { value: "portal", label: "Portal / ilan ücreti" },
  { value: "ofis", label: "Ofis malzemesi" },
  { value: "diger_gider", label: "Diğer" },
] as const;

export type ExpenseClaimCategory = (typeof EXPENSE_CLAIM_CATEGORIES)[number]["value"];

export function isExpenseClaimCategory(v: unknown): v is ExpenseClaimCategory {
  return typeof v === "string" && EXPENSE_CLAIM_CATEGORIES.some((c) => c.value === v);
}

export function expenseClaimCategoryLabel(v: string): string {
  return EXPENSE_CLAIM_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

/** Fiş: telefon fotoğrafı ya da PDF, en fazla 5 MB (kova sınırı ile aynı). */
export const EXPENSE_CLAIM_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const EXPENSE_CLAIM_RECEIPT_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function receiptExtension(mime: string): string | null {
  return EXPENSE_CLAIM_RECEIPT_TYPES[mime.toLowerCase().split(";", 1)[0]!.trim()] ?? null;
}

export function validateReceiptFile(file: { size: number; type: string }): { ok: true; ext: string; mime: string } | { ok: false; error: string } {
  const mime = file.type.toLowerCase().split(";", 1)[0]!.trim();
  const ext = receiptExtension(mime);
  if (!ext) return { ok: false, error: "Fiş için fotoğraf (JPG, PNG, WEBP, HEIC) ya da PDF seçin." };
  if (!(file.size > 0)) return { ok: false, error: "Fiş dosyası boş görünüyor." };
  if (file.size > EXPENSE_CLAIM_RECEIPT_MAX_BYTES) return { ok: false, error: "Fiş en fazla 5 MB olabilir; fotoğrafı daha düşük çözünürlükte çekin." };
  return { ok: true, ext, mime };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Fiş yolu yalnız bu ofisin bu kullanıcısının klasörü + sunucunun ürettiği uuid ad (DB kuralıyla aynı). */
export function isOwnReceiptPath(path: string, tenantId: string, userId: string): boolean {
  return new RegExp(`^${tenantId}/${userId}/${UUID}\\.(jpg|png|webp|heic|pdf)$`, "i").test(path);
}

export type ExpenseClaimStatus = "bekliyor" | "onaylandi" | "reddedildi" | "iptal";

export const EXPENSE_CLAIM_STATUS_LABEL: Record<ExpenseClaimStatus, string> = {
  bekliyor: "Onay bekliyor",
  onaylandi: "Onaylandı · deftere işlendi",
  reddedildi: "Reddedildi",
  iptal: "Geri çekildi",
};

export function expenseClaimStatusLabel(s: string): string {
  return EXPENSE_CLAIM_STATUS_LABEL[s as ExpenseClaimStatus] ?? s;
}

/** RPC sonucu → kullanıcı mesajı. */
export function expenseClaimOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "forbidden":
      return "Masraf bildirmek için ofis hesabıyla giriş yapın (salt okunur hesap bildirim açamaz).";
    case "invalid_receipt":
    case "receipt_missing":
      return "Fiş dosyası bulunamadı; fotoğrafı yeniden yükleyip tekrar deneyin.";
    case "duplicate":
      return "Bu fiş zaten bildirildi.";
    case "invalid_input":
      return "Girdiğiniz bilgileri kontrol edin: tutar, harcama günü (son bir yıl, bugünden ileri değil), kategori ve en az 3 harfli açıklama.";
    default:
      return "Masraf bildirimi kaydedilemedi. Lütfen tekrar deneyin.";
  }
}
