/**
 * Olay anahtarı (`posting_key`) üreticileri (SAF). Anahtar kiracı başına bir kez kullanılır (kısmi unique index):
 * aynı anahtarla tekrar `finance_post` çağrısı `duplicate` döner ve yeni satır yazmaz. İptal/ters kayıttan sonra
 * düzeltilmiş yeniden kayıt yeni sürüm anahtarı ister (`revisedKey`).
 *
 * Biçim (SQL `finance_post_internal` ile aynı): `<önek>(:<parça>)+`, parça `[A-Za-z0-9_.-]+`, en çok 200 karakter.
 * Ayrılmış ekler: ikinci bacak `#2` (transfer), ayna kayıt `:rev` — çağıran bunları üretmez.
 */
import type { PostingEventType } from "./rules";
import { postingRule } from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PART_RE = /^[A-Za-z0-9_.-]+$/;
export const POSTING_KEY_MAX = 200;

function id(value: string): string {
  const v = value.trim().toLowerCase();
  if (!UUID_RE.test(v)) throw new Error("posting_key: geçersiz kimlik");
  return v;
}

function seq(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error("posting_key: sıra 1 veya daha büyük tam sayı olmalı");
  return String(n);
}

/** Komisyon tahakkuku: `commission:{id}`. */
export const commissionKey = (commissionId: string) => `commission:${id(commissionId)}`;
/** Komisyonun n. tahsilatı (kısmi tahsilat): `commission:{id}:col:{n}`. */
export const commissionCollectionKey = (commissionId: string, n: number) => `commission:${id(commissionId)}:col:${seq(n)}`;
/** Ofis dışı pay tahakkuku: `split:{id}`. */
export const splitKey = (splitId: string) => `split:${id(splitId)}`;
/** Hakediş ödemesi: `payout:{id}`; kişisel Kasam'a işleme: `payout:{id}:personal`. */
export const payoutKey = (payoutId: string) => `payout:${id(payoutId)}`;
export const payoutPersonalKey = (payoutId: string) => `payout:${id(payoutId)}:personal`;
/** Payı (split) olmayan hakedişin onay tahakkuku (WP2 tetikleyicisi yazar): `payout:{id}:approved`. */
export const payoutApprovedKey = (payoutId: string) => `payout:${id(payoutId)}:approved`;
/** Kira tahakkuku (yalnız görünüm, kayıt yazmaz): `rent_charge:{id}`. */
export const rentChargeKey = (chargeId: string) => `rent_charge:${id(chargeId)}`;
/** Kira tahsilatı (rent_payments): `rent:{id}`. */
export const rentPaymentKey = (paymentId: string) => `rent:${id(paymentId)}`;
/** Mülk sahibi ödemesi (owner_payouts): `owner_payout:{id}`. */
export const ownerPayoutKey = (ownerPayoutId: string) => `owner_payout:${id(ownerPayoutId)}`;
/** Depozito (kiralama başına sıralı): `deposit:{rentalId}:in:{n}` / `deposit:{rentalId}:out:{n}`. */
export const depositKey = (rentalId: string, kind: "in" | "out", n: number) => `deposit:${id(rentalId)}:${kind}:${seq(n)}`;
/** Bina aidatı tahakkuku: `building_charge:{id}`; tahsilatı (building_payments): `building:{id}`. */
export const buildingChargeKey = (chargeId: string) => `building_charge:${id(chargeId)}`;
export const buildingPaymentKey = (paymentId: string) => `building:${id(paymentId)}`;
/** Aidat tahakkuku: `due:{id}`; n. ödemesi: `due:{id}:pay:{n}`. */
export const dueKey = (dueId: string) => `due:${id(dueId)}`;
export const dueSettleKey = (dueId: string, n: number) => `due:${id(dueId)}:pay:${seq(n)}`;
/** Kesilen e-fatura: `einvoice:{id}`; gelen fatura (istemci kimliği): `invoice_in:{uuid}`. */
export const einvoiceKey = (einvoiceId: string) => `einvoice:${id(einvoiceId)}`;
export const invoiceReceivedKey = (requestId: string) => `invoice_in:${id(requestId)}`;
/** Gider ödemesi / transfer: istemcinin form başına ürettiği istek kimliği (çift tıklama tek kayıt). */
export const expenseKey = (requestId: string) => `expense:${id(requestId)}`;
export const transferKey = (requestId: string) => `transfer:${id(requestId)}`;
/** Platform abonelik faturası: `subscription:{invoiceId}`. */
export const subscriptionKey = (invoiceId: string) => `subscription:${id(invoiceId)}`;

/** İptal/ters kayıt sonrası düzeltilmiş yeniden kayıt: `<anahtar>:r{n}` (n ≥ 2). */
export function revisedKey(key: string, revision: number): string {
  if (!Number.isInteger(revision) || revision < 2) throw new Error("posting_key: sürüm 2 veya daha büyük olmalı");
  const out = `${key}:r${revision}`;
  if (!isPostingKey(out)) throw new Error("posting_key: geçersiz anahtar");
  return out;
}

/** Biçim denetimi (SQL ile aynı kural); önek verilirse olay türünün önekiyle başlamalı. */
export function isPostingKey(value: unknown, eventType?: PostingEventType): boolean {
  if (typeof value !== "string" || value.length < 3 || value.length > POSTING_KEY_MAX) return false;
  if (value.endsWith(":rev")) return false;
  const [prefix, ...parts] = value.split(":");
  if (!prefix || !/^[a-z_]+$/.test(prefix) || parts.length === 0 || !parts.every((p) => PART_RE.test(p))) return false;
  return eventType ? prefix === postingRule(eventType).keyPrefix : true;
}

/** Ayna (ters) kaydın anahtarı: `<asıl anahtar>:rev` (SQL finance_reverse_internal ile aynı). */
export const reversalKeyOf = (key: string) => `${key}:rev`;
/** Transferin n. bacağı (n ≥ 2): `<anahtar>#n`; ilk bacak anahtarın kendisidir. */
export const legKeyOf = (key: string, leg: number) => (leg <= 1 ? key : `${key}#${leg}`);
