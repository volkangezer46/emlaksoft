import { z } from "zod";
import { EF_DEFAULT_PACKS, type EfPack } from "@/lib/ef-credits/config";

/**
 * Admin kontör yönetimi: SAF doğrulama ve ön ayar (I/O yok; istemci/sunucu güvenli).
 * Manuel yükleme: yalnız POZİTİF kontör; negatif düzeltme YOK. Gerekçe ZORUNLU.
 */

export const ADMIN_GRANT_KINDS = ["admin", "bonus", "refund"] as const;
export type AdminGrantKind = (typeof ADMIN_GRANT_KINDS)[number];
export const ADMIN_GRANT_KIND_LABEL: Record<AdminGrantKind, string> = {
  admin: "Düzeltme / yükleme",
  bonus: "Bonus",
  refund: "İade (gerekçeli)",
};

export const efAdminGrantSchema = z.object({
  tenantId: z.string().uuid("Geçersiz ofis."),
  units: z.coerce
    .number()
    .int("Kontör tam sayı olmalı.")
    .min(1, "Kontör en az 1 olmalı (negatif düzeltme yapılamaz).")
    .max(100000, "Tek seferde en çok 100.000 kontör."),
  kind: z.enum(ADMIN_GRANT_KINDS),
  reason: z.string().trim().min(10, "Gerekçe zorunlu (en az 10 karakter).").max(300, "Gerekçe en çok 300 karakter."),
  /** Formdan gelen TEK KULLANIMLIK anahtar (çift tıklama/yeniden gönderim aynı yüklemeyi bir kez yapar). */
  idemKey: z.string().trim().regex(/^[A-Za-z0-9_-]{16,64}$/, "Geçersiz işlem anahtarı; sayfayı yenileyin."),
});
export type EfAdminGrantInput = z.infer<typeof efAdminGrantSchema>;

/**
 * "Önerilen ön ayar": 2026-10-08 fiyat kararı paketleri (1 kontör = 1 TL; KDV hariç net; birim fiyat 1,00 -> 0,80).
 * Admin'e taslak olarak sunulur, KAYDEDİLMEDEN uygulanmaz.
 */
export const EF_PACK_PRESET_NOTE =
  "Önerilen katalog (1 kontör = 1 TL, KDV hariç net; büyük pakette kontör başı fiyat düşer). Düzenleyebilirsiniz.";

export function examplePackPreset(): EfPack[] {
  return EF_DEFAULT_PACKS.map((p) => ({ ...p }));
}

/** Paket id'si üretimi: ad -> a-z0-9- (TR harfleri sadeleşir), 2-32 karakter. */
export function packIdFromName(name: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  const s = name
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s.length >= 2 ? s : `paket-${s || "x"}`.slice(0, 32);
}
