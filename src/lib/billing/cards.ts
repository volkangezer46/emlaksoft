/**
 * Kayıtlı kart — SAF katman (sunucu/DB bağımsız). Kart iyzico'da saklanır; bizde yalnız sağlayıcı anahtarları ve
 * maskeli gösterim vardır. Ham kart no / CVC / son kullanma BU DOSYAYA ve DB'ye GİRMEZ (bkz. pci-card-data-contract.test.ts).
 */
import type { CheckoutRetrieveResult } from "@/lib/billing/iyzico";

/** Açık rıza metni sürümü: metin değişirse artırılır, kayıt hangi metne onay verildiğini taşır. */
export const CARD_CONSENT_VERSION = "card-save-v1";
/** platform_settings anahtarı: yalnız "true" ise otomatik yenileme kod yolu çalışır (varsayılan KAPALI). */
export const AUTO_RENEW_FLAG_KEY = "billing.auto_renew_enabled";
/** Saklı kart ödemesi için fatura meta işareti (kullanıcı onay kutusunu işaretledi). */
export const SAVE_CARD_META_KEY = "saveCard";

export const CARD_CONSENT_TEXT =
  "Kartımı sonraki ödemelerim için iyzico'da saklamayı kabul ediyorum. Kart bilgilerim EmlakSoft sunucularında tutulmaz; " +
  "yalnızca iyzico güvenli kasasında saklanır. Kayıtlı kartı istediğim zaman silebilirim.";

export type StoredCardRef = {
  providerCardUserKey: string;
  providerCardToken: string;
  brand: string | null;
  cardFamily: string | null;
  binPrefix: string;
  lastFour: string;
};

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** Bayrak değeri: yalnız tam olarak "true" (büyük/küçük harf ve boşluk toleranslı) AÇIK sayılır. */
export function parseAutoRenewFlag(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/**
 * Ödeme yanıtındaki kart alanlarından kaydedilecek referansı çıkarır. Eksik/biçimsiz alan varsa null (kart
 * kaydedilmez, ödeme etkilenmez). Yalnız ilk 6 (BIN) ve son 4 hane alınır; başka rakam dizisi alınmaz.
 */
export function extractStoredCard(result: CheckoutRetrieveResult): StoredCardRef | null {
  const userKey = String(result.cardUserKey ?? "").trim();
  const token = String(result.cardToken ?? "").trim();
  if (!KEY_RE.test(userKey) || !KEY_RE.test(token)) return null;
  const bin = String(result.binNumber ?? "").replace(/\D/g, "");
  const last4 = String(result.lastFourDigits ?? "").replace(/\D/g, "");
  if (bin.length < 6 || last4.length !== 4) return null;
  const brand = String(result.cardAssociation ?? "").trim().slice(0, 32) || null;
  const family = String(result.cardFamily ?? "").trim().slice(0, 48) || null;
  return {
    providerCardUserKey: userKey,
    providerCardToken: token,
    brand,
    cardFamily: family,
    binPrefix: bin.slice(0, 6),
    lastFour: last4,
  };
}

const BRAND_LABEL: Record<string, string> = {
  VISA: "Visa",
  MASTER_CARD: "Mastercard",
  AMERICAN_EXPRESS: "American Express",
  TROY: "Troy",
};

export function cardBrandLabel(brand: string | null | undefined): string {
  const key = String(brand ?? "").toUpperCase();
  return BRAND_LABEL[key] ?? (brand ? String(brand) : "Kart");
}

/** "Visa · 5528 79•• •••• 1234" — ilk 6 + son 4 (PCI'nin izin verdiği azami gösterim). */
export function maskedCardLabel(card: { brand?: string | null; bin_prefix: string; last_four: string }): string {
  const bin = `${card.bin_prefix.slice(0, 4)} ${card.bin_prefix.slice(4, 6)}••`;
  return `${cardBrandLabel(card.brand)} · ${bin} •••• ${card.last_four}`;
}

export type PaymentCardRow = {
  id: string;
  brand: string | null;
  card_family: string | null;
  bin_prefix: string;
  last_four: string;
  is_default: boolean;
  consent_at: string;
  created_at: string;
};

/** Otomatik yenilemede hangi aboneliklerin denenebileceğinin saf kararı (flag/rıza dışı kurallar). */
export const AUTO_RENEW_MAX_ATTEMPTS = 3;
export const AUTO_RENEW_RETRY_GAP_MS = 3 * 24 * 60 * 60 * 1000;

export function autoRenewAttemptAllowed(input: {
  priorAttempts: number;
  lastAttemptAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.priorAttempts >= AUTO_RENEW_MAX_ATTEMPTS) return false;
  if (input.lastAttemptAtMs !== null && input.nowMs - input.lastAttemptAtMs < AUTO_RENEW_RETRY_GAP_MS) return false;
  return true;
}
