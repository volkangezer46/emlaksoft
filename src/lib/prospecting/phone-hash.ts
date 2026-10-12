import { createHash } from "node:crypto";

/**
 * Telefon özeti (yalnız SUNUCU). Aranmasın listesi ve tekrar ilan eşleşmesi ham numarayı saklamadan çalışsın diye
 * `sha256("fsbo-v1|<kiracı>|<saklama biçimi>")` hex özeti tutulur: kiracı tuzlu olduğundan ofisler arası eşleşme yoktur.
 * Girdi `parsePhoneStrict().stored` olmalıdır (tek biçim). Biçim değişirse "fsbo-v1" artırılır.
 */
export function phoneHash(tenantId: string, storedPhone: string): string {
  return createHash("sha256").update(`fsbo-v1|${tenantId}|${storedPhone.trim()}`, "utf8").digest("hex");
}
