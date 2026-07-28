/**
 * Kazanılan anlaşmanın portföy durumuna yansıması — tek doğruluk kaynağı.
 *
 * NEDEN AYRI MODÜL (denetim bulgusu P0): `deals.ts` ve `workflow.ts` anlaşma
 * "won" olunca portföye KOŞULSUZ `status = 'sold'` yazıyordu. Kira anlaşması
 * kazanıldığında da aynı satır çalışıyor, kiralık portföy kalıcı "Satıldı"
 * damgası yiyordu: eşleştirmeden, vitrinden ve aktif portföy listelerinden
 * düşüyor, geri dönüşü yalnız elle düzeltmeyle oluyordu.
 *
 * `properties.status` serbest metin (DB'de CHECK yok); geçerli değerler
 * `definitions` tablosundaki `property_status` sözlüğünde tanımlı
 * (migration 20260723000034). Orada `sold` → "Satıldı" ve `rented` →
 * "Kiralandı" ZATEN mevcut; bu yüzden yeni bir değer/migration gerekmedi.
 */

/** `deals.deal_type` alanının kabul ettiği değerler. */
export type DealType = "sale" | "rent";

/** Kazanılan anlaşmanın portföye yazacağı `properties.status` değeri. */
export function wonDealPropertyStatus(dealType: string | null | undefined): "sold" | "rented" {
  return dealType === "rent" ? "rented" : "sold";
}

/** Portföyün "artık aktif değil" damgası — kapanış sonrası durumlar. */
export const CLOSED_PROPERTY_STATUSES = ["sold", "rented"] as const;
