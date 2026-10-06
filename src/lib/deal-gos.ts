/**
 * Anlaşma GÖS alanları (SAF): Güvenli Ödeme Sistemi referans no + tapu randevu tarihi.
 * DB kısıtı (20261007000300) ile birebir aynı desen. Para/IBAN/hesap bilgisi TUTULMAZ (bkz. gos-info.ts).
 */
import { parseTrLocalDateTime } from "@/lib/clock";

/** DB CHECK `deals_gos_reference_no_format` ile aynı. */
export const GOS_REFERENCE_PATTERN = /^[A-Za-z0-9./ _-]{3,64}$/;

export type DealGosInput = { referenceNo: string | null; titleDeedAt: string | null };
export type DealGosParse = { ok: true; value: DealGosInput } | { ok: false; error: string };

/** Boş alanlar geçerlidir (null). Tarih `datetime-local` (TR saati) ya da ISO kabul edilir. */
export function parseDealGosInput(rawRef: unknown, rawDate: unknown): DealGosParse {
  const ref = String(rawRef ?? "").replace(/\s+/g, " ").trim();
  if (ref && !GOS_REFERENCE_PATTERN.test(ref)) {
    return { ok: false, error: "GÖS referans no 3-64 karakter olmalı; yalnız harf, rakam, boşluk ve . / _ - kullanılabilir." };
  }
  const dateRaw = String(rawDate ?? "").trim();
  let titleDeedAt: string | null = null;
  if (dateRaw) {
    const d = parseTrLocalDateTime(dateRaw);
    if (!d) return { ok: false, error: "Tapu randevu tarihi geçerli değil." };
    const y = d.getUTCFullYear();
    if (y < 2020 || y > 2100) return { ok: false, error: "Tapu randevu yılı 2020-2100 arasında olmalı." };
    titleDeedAt = d.toISOString();
  }
  return { ok: true, value: { referenceNo: ref || null, titleDeedAt } };
}

/** Kolon yok (migration uygulanmadı) hatası mı? */
export function isMissingDealGosColumn(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /gos_reference_no|title_deed_appointment_at/.test(String(error.message ?? ""));
}
