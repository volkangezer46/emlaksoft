import { EF_DEFAULT_PACKS, type EfPack } from "@/lib/ef-credits/pack-core";

/** Admin yükleme türleri ve paket ön ayarı: zod'suz çekirdek (istemci editörü içe aktarır). */
export const ADMIN_GRANT_KINDS = ["admin", "bonus", "refund"] as const;
export type AdminGrantKind = (typeof ADMIN_GRANT_KINDS)[number];
export const ADMIN_GRANT_KIND_LABEL: Record<AdminGrantKind, string> = {
  admin: "Düzeltme / yükleme",
  bonus: "Bonus",
  refund: "İade (gerekçeli)",
};

/**
 * "Önerilen ön ayar": 2026-10-10 süreli paket kataloğu (aylık 1.000/2.500/5.000 TL x 1/3/6/12 ay; 1 birim = 1 TL, uzun süreye %5/%10/%15 indirim).
 * Admin'e taslak olarak sunulur, KAYDEDİLMEDEN uygulanmaz.
 */
export const EF_PACK_PRESET_NOTE =
  "Önerilen katalog (KDV hariç net; uzun süreli pakette 1 TL bakiye başı fiyat düşer, süre sonunda kullanılmayan bakiye sona erer). Düzenleyebilirsiniz.";

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
