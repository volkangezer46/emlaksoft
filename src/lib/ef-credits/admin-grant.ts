import { z } from "zod";
import { EF_DEFAULT_GRANT_VALID_MONTHS } from "@/lib/ef-credits/pack-core";
import { ADMIN_GRANT_KINDS } from "@/lib/ef-credits/admin-grant-core";
export * from "@/lib/ef-credits/admin-grant-core";

/**
 * Admin analiz bakiyesi yönetimi: SAF doğrulama (I/O yok). Çekirdek sabitler admin-grant-core.ts'te (zod'suz).
 * Manuel yükleme: yalnız POZİTİF analiz bakiyesi; negatif düzeltme YOK. Gerekçe ZORUNLU.
 */

export const efAdminGrantSchema = z.object({
  tenantId: z.string().uuid("Geçersiz ofis."),
  units: z.coerce
    .number()
    .int("Analiz bakiyesi tam sayı olmalı.")
    .min(1, "Analiz bakiyesi en az 1 olmalı (negatif düzeltme yapılamaz).")
    .max(100000, "Tek seferde en çok 100.000 TL."),
  kind: z.enum(ADMIN_GRANT_KINDS),
  reason: z.string().trim().min(10, "Gerekçe zorunlu (en az 10 karakter).").max(300, "Gerekçe en çok 300 karakter."),
  /** Yükleme geçerliliği (ay): 1 | 3 | 6 | 12; analiz bakiyesi süre sonunda yanar. Verilmezse 12. */
  validityMonths: z.coerce.number().int().refine((m) => [1, 3, 6, 12].includes(m), "Geçerlilik 1, 3, 6 veya 12 ay olmalı.").default(EF_DEFAULT_GRANT_VALID_MONTHS),
  /** Formdan gelen TEK KULLANIMLIK anahtar (çift tıklama/yeniden gönderim aynı yüklemeyi bir kez yapar). */
  idemKey: z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/, "Geçersiz işlem anahtarı; sayfayı yenileyin."),
});
export type EfAdminGrantInput = z.infer<typeof efAdminGrantSchema>;
