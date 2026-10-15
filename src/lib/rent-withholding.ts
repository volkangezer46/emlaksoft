/**
 * Kira stopajı (SP9) — SAF yardımcılar. Kiracı stopaj kesmekle yükümlüyse (ör. şirket/kurum kiracı) brüt kiradan
 * oran kadar stopaj keser, malike NET öder ve stopajı vergi dairesine kendisi yatırır.
 *
 * Veritabanında tahakkuk NET yazılır (`rent_charges.amount`), stopaj ayrı sütundadır (`withholding_amount`); bu hesap
 * tetikleyiciyle aynıdır (yuvarlama: kuruş). Oranlar mevzuata göre değişebilir; ofis kayıt başına ayarlar.
 */

export const RENTAL_USAGES = [
  { value: "konut", label: "Konut" },
  { value: "isyeri", label: "İşyeri" },
] as const;
export type RentalUsage = (typeof RENTAL_USAGES)[number]["value"];

export function parseRentalUsage(raw: unknown): RentalUsage {
  return raw === "isyeri" ? "isyeri" : "konut";
}

/** İşyeri kirasında kurum kiracı için önerilen varsayılan oran (%). Ayarlanabilir; mevzuat değişirse güncellenir. */
export const DEFAULT_WORKPLACE_WITHHOLDING_RATE = 20;
export const MAX_WITHHOLDING_RATE = 50;

/** "20" / "20,5" / "" → oran; boş = 0. Geçersizse null. */
export function parseWithholdingRate(raw: unknown): number | null {
  const t = String(raw ?? "").trim().replace(",", ".");
  if (!t) return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= MAX_WITHHOLDING_RATE ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Brüt kiradan stopaj ve net (tetikleyiciyle aynı hesap). */
export function splitGrossRent(gross: number, ratePct: number): { gross: number; withholding: number; net: number } {
  if (!(gross > 0) || !(ratePct > 0)) return { gross, withholding: 0, net: gross };
  const withholding = round2((gross * ratePct) / 100);
  if (withholding <= 0 || withholding >= gross) return { gross, withholding: 0, net: gross };
  return { gross, withholding, net: round2(gross - withholding) };
}

export const WITHHOLDING_TENANT_NOTE =
  "Stopajı kiracı keser ve muhtasar beyanla vergi dairesine kendisi yatırır; malike net tutar ödenir. " +
  "Tahakkuk net tutar üzerinden açılır, gecikme bedeli de net üzerinden hesaplanır.";

export const WITHHOLDING_OWNER_NOTE =
  "Kiracınızın kestiği stopaj, yıllık beyannamenizde hesaplanan vergiden mahsup edilebilir. " +
  "Beyan yöntemi ve tutarı için mali müşavirinize danışın; bu ekstre vergi hesaplamaz.";
