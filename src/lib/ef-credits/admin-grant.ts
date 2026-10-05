import { z } from "zod";
import type { EfPack } from "@/lib/ef-credits/config";

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
});
export type EfAdminGrantInput = z.infer<typeof efAdminGrantSchema>;

/**
 * "Örnek ön ayar": ADMİN'e öneri olarak sunulur, KAYDEDİLMEDEN uygulanmaz. Fiyatlar ÖRNEKTİR (KDV hariç net);
 * varsayılan katalog BOŞTUR, gerçek fiyat sahibin kararıdır.
 */
export const EF_PACK_PRESET_NOTE =
  "ÖRNEK fiyatlardır (KDV hariç net), sahibin kararı değildir: düzenleyin. Bilgi: EmlakFiyati kendi sitesinde 5'li paketi 549 TL (KDV dahil) satar.";

export function examplePackPreset(): EfPack[] {
  return [
    { id: "mini", name: "Mini", units: 10, priceNetTry: 175, active: true, order: 10 },
    { id: "standart", name: "Standart", units: 25, priceNetTry: 390, active: true, popular: true, order: 20 },
    { id: "plus", name: "Plus", units: 100, priceNetTry: 1250, active: true, order: 30 },
    { id: "pro", name: "Pro", units: 300, priceNetTry: 3300, active: true, order: 40 },
  ];
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
