/**
 * Tavsiye listesi süzgeçleri — KPI kartının sayısı ile kartın götürdüğü liste AYNI kümeyi verir (sıfır çıkmaz metrik).
 *
 * "Müşteriye dönen": müşteri kaydı oluşmuş (`created_customer_id`) YA DA durumu Müşteri/Kazanıldı olan tavsiye.
 * Eskiden sayı yalnız `created_customer_id`'yi sayıyor, kart ise `durum=musteri`'ye gidiyordu: kazanılmış tavsiye
 * "Müşteriye dönen 0" altında kalıyor, karttaki sayı ile liste farklı çıkıyordu.
 */

export const REFERRAL_STATUS_KEYS = ["yeni", "iletisim", "musteri", "kazanildi", "kayip"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUS_KEYS)[number];

/** Durum seçicisindeki sanal süzgeç: müşteriye dönüşen tüm tavsiyeler. */
export const REFERRAL_CONVERTED_FILTER = "donen";

export const REFERRAL_CONVERTED_OR = "created_customer_id.not.is.null,status.in.(musteri,kazanildi)";

export type ReferralFilter = { kind: "none" } | { kind: "status"; status: ReferralStatus } | { kind: "converted" };

export function parseReferralFilter(raw: string | undefined | null): ReferralFilter {
  const v = String(raw ?? "").trim();
  if (v === REFERRAL_CONVERTED_FILTER) return { kind: "converted" };
  if ((REFERRAL_STATUS_KEYS as readonly string[]).includes(v)) return { kind: "status", status: v as ReferralStatus };
  return { kind: "none" };
}

/** Süzgecin URL değeri ("" = tümü). */
export function referralFilterValue(f: ReferralFilter): string {
  return f.kind === "status" ? f.status : f.kind === "converted" ? REFERRAL_CONVERTED_FILTER : "";
}
