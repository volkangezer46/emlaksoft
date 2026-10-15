/**
 * Alan (m²) girdisi — SAF, tek kural (B093). Sunucu eylemleri (portföy oluştur/güncelle, talep min m², değerleme,
 * tapu OCR yüzölçümü) bunu kullanır; ayrıştırma `parseTrDecimal` ile istemci özetiyle (`parseLooseNumber`) aynıdır.
 *
 *  - "1.250" → 1250 (binlik), "1.250,5" → 1250.5, "120 m²" → 120, "" → null (asla 0 değil).
 *  - Geçersiz değer alan adıyla reddedilir: `{ ok: false, error: "Brüt m² geçersiz: \"abc\"" }`.
 *  - Konut türlerinde (Daire, Villa, Müstakil ev ...) 10 m² altı kabul edilmez: "1,25" gibi yanlış ayraçla girilen
 *    değerler ("1.250" yerine) sessizce 1,25 m² kaydı açmasın.
 */
import { parseTrDecimal } from "@/lib/money-input";

export const AREA_MAX_SQM = 100_000_000;
export const RESIDENTIAL_MIN_SQM = 10;

const RESIDENTIAL_TYPES = new Set(
  ["daire", "villa", "müstakil ev", "rezidans", "yazlık", "köşk", "konut", "dubleks", "tripleks", "çiftlik evi"],
);

/** Konut türü mü (m² alt sınırı yalnız bunlarda uygulanır; arsa/depo/otopark serbest). */
export function isResidentialPropertyType(propertyType: string | null | undefined): boolean {
  return RESIDENTIAL_TYPES.has(String(propertyType ?? "").trim().toLocaleLowerCase("tr-TR"));
}

export type AreaParseResult = { ok: true; value: number | null } | { ok: false; value: null; error: string };

export function parseAreaInput(
  raw: FormDataEntryValue | string | number | null | undefined,
  options: { label: string; propertyType?: string | null },
): AreaParseResult {
  const parsed = parseTrDecimal(raw, { max: AREA_MAX_SQM });
  const shown = String(raw ?? "").trim().slice(0, 30);
  if (!parsed.ok) return { ok: false, value: null, error: `${options.label} geçersiz: "${shown}". Örn. 120 ya da 1.250` };
  const value = parsed.value;
  if (value != null && isResidentialPropertyType(options.propertyType) && value < RESIDENTIAL_MIN_SQM) {
    return {
      ok: false,
      value: null,
      error: `${options.label} konutta en az ${RESIDENTIAL_MIN_SQM} m² olmalı ("${shown}"). Binlik ayraç için nokta kullanın: 1.250`,
    };
  }
  return { ok: true, value };
}
