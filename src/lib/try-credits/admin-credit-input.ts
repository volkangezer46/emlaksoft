/**
 * Platform yöneticisi "Hesap kredisi yükle / geri al" — SAF girdi doğrulaması (DB yok, istemci güvenli).
 * Sunucu action'ı: src/app/actions/admin-account-credit.ts. RPC sözleşmesi: ./config.ts (try_credit_grant / _reverse).
 *
 * Çift gönderim anahtarı: form açılırken istemcide üretilen `request_id` (uuid). Aynı anahtarla gelen ikinci gönderim
 * defterde (tenant, idem) tekilliği sayesinde YENİ kayıt yazmaz (`already: true`).
 * Tutar üst sınırı yalnız yanlış yazım güvenliğidir (fazladan sıfır); ödül/fiyat kararı DEĞİLDİR.
 */
import { KURUS, TRY_IDEM_PATTERN, type TryGrantKind } from "./config";

/** Tek işlemde yüklenebilecek/geri alınabilecek en yüksek tutar (TL). Yazım hatası güvenliği; gerekirse sahip değiştirir. */
export const ADMIN_CREDIT_MAX_TRY = 50_000;
export const ADMIN_CREDIT_REASON_MIN = 10;
export const ADMIN_CREDIT_REASON_MAX = 500;

/** Yöneticinin seçebileceği yükleme türleri (referans/ortak/iade motorlara aittir, elle seçilmez). */
export const ADMIN_GRANT_KINDS = ["manual", "bonus", "campaign"] as const satisfies readonly TryGrantKind[];
export type AdminGrantKind = (typeof ADMIN_GRANT_KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Source = { get(key: string): FormDataEntryValue | null };
const text = (src: Source, key: string) => String(src.get(key) ?? "").trim();

/** "1.250,50" / "1250.5" / "1250" -> 1250.5; geçersizse NaN. En çok 2 ondalık (kuruş). */
export function parseTryAmount(raw: string): number {
  const s = raw.replace(/\s|₺|TL/gi, "");
  if (!s) return Number.NaN;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * KURUS) / KURUS;
}

export type AdminCreditCommon = { tenantId: string; amountTry: number; reason: string; requestId: string };
export type AdminGrantInput = AdminCreditCommon & { kind: AdminGrantKind; expiresAt: string | null; idem: string };
export type AdminReverseInput = AdminCreditCommon & { originalIdem: string | null; idem: string };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function common(src: Source): Parsed<AdminCreditCommon> {
  const tenantId = text(src, "tenant_id");
  if (!UUID_RE.test(tenantId)) return { ok: false, error: "Ofis seçimi geçersiz." };
  const requestId = text(src, "request_id");
  if (!UUID_RE.test(requestId)) return { ok: false, error: "İstek kimliği eksik. Formu yenileyip tekrar deneyin." };
  const amountTry = parseTryAmount(text(src, "amount"));
  if (!Number.isFinite(amountTry) || amountTry <= 0) return { ok: false, error: "Geçerli bir tutar girin (en çok 2 ondalık)." };
  if (amountTry > ADMIN_CREDIT_MAX_TRY) {
    return { ok: false, error: `Tek işlemde en fazla ${ADMIN_CREDIT_MAX_TRY.toLocaleString("tr-TR")} TL işlenebilir.` };
  }
  const reason = text(src, "reason").replace(/\s+/g, " ");
  if (reason.length < ADMIN_CREDIT_REASON_MIN || reason.length > ADMIN_CREDIT_REASON_MAX) {
    return { ok: false, error: `Neden ${ADMIN_CREDIT_REASON_MIN}-${ADMIN_CREDIT_REASON_MAX} karakter olmalı.` };
  }
  return { ok: true, value: { tenantId, amountTry, reason, requestId } };
}

/** Yükleme girdisi. `nowMs` dışarıdan verilir (saf). Vade: seçilen günün sonu (Türkiye saati), gelecekte olmalı. */
export function parseAdminGrantInput(src: Source, nowMs: number): Parsed<AdminGrantInput> {
  const base = common(src);
  if (!base.ok) return base;
  const rawKind = text(src, "kind") || "manual";
  if (!(ADMIN_GRANT_KINDS as readonly string[]).includes(rawKind)) return { ok: false, error: "Yükleme türü geçersiz." };
  const rawExpiry = text(src, "expires_on");
  let expiresAt: string | null = null;
  if (rawExpiry) {
    if (!DATE_RE.test(rawExpiry)) return { ok: false, error: "Son kullanma tarihi geçersiz." };
    expiresAt = `${rawExpiry}T23:59:59+03:00`;
    const ms = Date.parse(expiresAt);
    if (!Number.isFinite(ms) || ms <= nowMs) return { ok: false, error: "Son kullanma tarihi gelecekte olmalı." };
  }
  return {
    ok: true,
    value: { ...base.value, kind: rawKind as AdminGrantKind, expiresAt, idem: `admin-grant:${base.value.requestId}` },
  };
}

/** Geri alma girdisi. `original_idem` verilirse toplam geri alma o yüklemeyi aşamaz (SQL denetler). */
export function parseAdminReverseInput(src: Source): Parsed<AdminReverseInput> {
  const base = common(src);
  if (!base.ok) return base;
  const originalIdem = text(src, "original_idem") || null;
  if (originalIdem && !TRY_IDEM_PATTERN.test(originalIdem)) return { ok: false, error: "Geri alınacak yükleme anahtarı geçersiz." };
  return { ok: true, value: { ...base.value, originalIdem, idem: `admin-reverse:${base.value.requestId}` } };
}
