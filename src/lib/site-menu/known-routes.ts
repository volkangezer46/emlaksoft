import { publishedTools } from "@/lib/tools/registry";

/**
 * Herkese açık sitede var olan sayfa yolları ve ana sayfa bölüm bağlantıları (menü doğrulamasının tek kaynağı).
 * Olmayan bir sayfaya menü bağlantısı kaydedilemez. `known-routes.test.ts` her yolun gerçekten bir
 * `page.tsx` dosyasına, her bölüm bağlantısının ana sayfadaki gerçek bir `id`'ye karşılık geldiğini doğrular;
 * yeni herkese açık sayfa eklenince bu listeye de eklenir.
 */
export const STATIC_PUBLIC_PATHS = [
  "/",
  "/fiyatlar",
  "/kayit",
  "/giris",
  "/demo",
  "/araclar",
  "/kvkk-aydinlatma",
  "/gizlilik",
  "/cerez-politikasi",
  "/kullanim-sartlari",
  "/mesafeli-satis",
  "/on-bilgilendirme",
  "/iptal-iade",
] as const;

/** Ana sayfadaki bölüm kimlikleri (`/#tur` gibi). */
export const HOME_ANCHORS = [
  "tur",
  "ozellikler",
  "kayip-kacak",
  "degerleme",
  "otomasyon",
  "portal-kontrol",
  "imza",
  "ai-asistan",
  "vitrin",
  "nasil",
  "neden",
  "fiyat",
  "sss",
  "guvenlik",
] as const;

export function knownPublicPaths(): string[] {
  return [...STATIC_PUBLIC_PATHS, ...publishedTools().map((t) => `/araclar/${t.slug}`)];
}

export function isKnownPublicPath(path: string): boolean {
  return knownPublicPaths().includes(path);
}

export function isHomeAnchor(id: string): boolean {
  return (HOME_ANCHORS as readonly string[]).includes(id);
}
