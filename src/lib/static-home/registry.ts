/**
 * STATİK SAYFA KAYIT DEFTERİ (tek kaynak): saf HTML olarak sunulabilecek herkese açık sayfalar.
 *
 * - Yalnız buradaki kimlikler `/api/statik/sayfa/<id>` rotasından sunulur; serbest yol parametresi YOK.
 * - Kaynak HTML her zaman `${origin}${path}` (sorgu dizesi atılır); önbellek anahtarı kimliktir.
 * - Üyelik/oturum yolları (`/app`, `/admin`, `/giris`, `/kayit`, `/sifre-yenile`, `/auth`, portallar…) bu listeye
 *   GİREMEZ: `isStaticEligiblePath` sözleşme testiyle denetlenir (src/lib/static-home/registry.test.ts).
 * - Yasal sayfalar varsayılan KAPALI başlar; sahip Hız ekranından (`/admin/site/hiz`) tek tuşla açar.
 *
 * SAF dosya (G/Ç yok): proxy, rota işleyicisi, admin ekranı ve `scripts/build-static-home.ts` aynı listeyi okur.
 */

/** `src/static-home/islands/<dosya>.tsx` adacık girişleri (derleme betiği bu eşlemeyi kullanır). */
export const STATIC_ISLAND_ENTRIES = {
  pricing: "pricing",
  seat: "seat-calculator",
  tour: "tour",
  preview: "menu-preview",
} as const;

export type StaticIslandKey = keyof typeof STATIC_ISLAND_ENTRIES;

export type StaticRouteId =
  | "home"
  | "gizlilik"
  | "kvkk-aydinlatma"
  | "kullanim-sartlari"
  | "cerez-politikasi"
  | "mesafeli-satis"
  | "on-bilgilendirme"
  | "iptal-iade"
  | "davet-kosullari"
  | "fiyatlar";

export type StaticRouteDef = {
  id: StaticRouteId;
  /** Kanonik yol (birebir eşleşme; sondaki "/" kabul edilmez). */
  path: string;
  /** Yönetim ekranındaki ad. */
  label: string;
  /** Sayfanın kullandığı adacıklar (yalnız bunların adresleri sayfaya gömülür). */
  islands: readonly StaticIslandKey[];
  /** CSS ayıklamasında her zaman korunan sınıf önekleri (çalışma anında JS ile eklenen durumlar). */
  keepPrefixes: readonly string[];
  /** DB ayarı (`statik.routes`) yokken açık mı? */
  defaultEnabled: boolean;
  /**
   * DOM diyeti: ilk yükte gerekmeyen işaretleme `<template>`'e alınır, çalışma zamanı gerektiğinde açar
   * (src/lib/static-home/lazy-dom.ts). Yalnız pazarlama çalışma zamanının tüm parçalarını taşıyan sayfalarda açılır.
   */
  lazyDom?: boolean;
  /** Kalıcı kapalı (anahtar gösterilir ama açılamaz) — nedeni yönetim ekranında yazar. */
  disabled?: string;
};

/** Pazarlama çalışma zamanının (src/static-home/runtime.ts) JS ile eklediği sınıflar. */
const KEEP_PREFIXES = ["mk-sheet", "mk-pause", "mk-feat-sw", "js-"] as const;

/**
 * Yasal sayfalar: adacıksız. LegalPage düzeninde ana sayfa üst menüsü (.mk-nav) yoktur, menü önizleme adacığı orada hiç
 * yüklenmez; ilk yükte Next/React JS'i yoktur.
 */
const legal = (id: StaticRouteId, label: string): StaticRouteDef => ({
  id,
  path: `/${id}`,
  label,
  islands: [],
  keepPrefixes: KEEP_PREFIXES,
  defaultEnabled: false,
});

export const STATIC_ROUTES: readonly StaticRouteDef[] = [
  { id: "home", path: "/", label: "Ana sayfa", islands: ["pricing", "seat", "tour", "preview"], keepPrefixes: KEEP_PREFIXES, defaultEnabled: true, lazyDom: true },
  legal("gizlilik", "Gizlilik politikası"),
  legal("kvkk-aydinlatma", "KVKK aydınlatma metni"),
  legal("kullanim-sartlari", "Kullanım şartları"),
  legal("cerez-politikasi", "Çerez politikası"),
  legal("mesafeli-satis", "Mesafeli satış sözleşmesi"),
  legal("on-bilgilendirme", "Ön bilgilendirme formu"),
  legal("iptal-iade", "İptal ve iade koşulları"),
  legal("davet-kosullari", "Davet koşulları"),
  {
    id: "fiyatlar",
    path: "/fiyatlar",
    label: "Fiyatlar",
    islands: ["pricing", "seat", "preview"],
    keepPrefixes: KEEP_PREFIXES,
    defaultEnabled: false,
    disabled: "Getiri hesaplayıcı adacığı henüz yok; sayfa normal sürümle sunulur.",
  },
];

const BY_ID = new Map<string, StaticRouteDef>(STATIC_ROUTES.map((r) => [r.id, r]));
const BY_PATH = new Map<string, StaticRouteDef>(STATIC_ROUTES.map((r) => [r.path, r]));

/** Kayıt kimliği → tanım (bilinmeyen kimlik null; `Object.prototype` anahtarları da null). */
export function staticRouteById(id: string): StaticRouteDef | null {
  return BY_ID.get(id) ?? null;
}

/** Birebir yol eşleşmesi (sorgu/sondaki "/" yok). */
export function staticRouteByPath(path: string): StaticRouteDef | null {
  return BY_PATH.get(path) ?? null;
}

/**
 * Yayın sonrası `livePaths` → etkilenen kimlikler. "*" (site çerçevesi: menü/altbilgi/marka) tüm kayıtları kapsar;
 * yollar sorgu/parça ve sondaki "/" atılarak birebir eşlenir. Sıra kayıt defteri sırasıdır, tekrar yok.
 */
export function matchStaticIds(livePaths: readonly string[]): StaticRouteId[] {
  if (livePaths.some((p) => p.trim() === "*")) return STATIC_ROUTES.map((r) => r.id);
  const want = new Set(
    livePaths.map((p) => {
      const bare = p.trim().split(/[?#]/)[0] ?? "";
      return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
    }),
  );
  return STATIC_ROUTES.filter((r) => want.has(r.path)).map((r) => r.id);
}

/** Rota işleyicisinin adresi (proxy buraya yeniden yazar). */
export function staticHandlerPath(id: StaticRouteId): string {
  return `/api/statik/sayfa/${id}`;
}

/**
 * Üyelik/oturum ve token'lı yüzeyler: hiçbir koşulda statik sunulmaz (proxy kararında da ayrıca denetlenir).
 * Kapsamın TEK kaynağı S0 `src/lib/seo/scope.ts`'tir; bu liste proxy'de çalıştığı için (hafif paket, ağır SEO kaydı
 * içe aktarılmaz) burada tutulur. `src/lib/seo/scope-single-source.test.ts` her statik yolun `canAutoOptimize` olduğunu
 * ve scope'un üyelik öneklerinin (MEMBER_PREFIXES) bu listede bulunduğunu doğrular.
 */
export const NEVER_STATIC_PREFIXES = [
  "/app",
  "/admin",
  "/giris",
  "/kayit",
  "/sifre-yenile",
  "/sifre-sifirla",
  "/auth",
  "/api",
  "/_next",
  "/bakim",
  "/onizleme",
  "/malik-portali",
  "/musteri-portali",
  "/odeme-link",
  "/imza",
  "/evrak",
  "/paylas",
  "/sunum",
  "/randevu-teyit",
  "/acik-ev-kayit",
  "/kiraci-basvuru",
  "/kariyer",
  "/anket",
  "/degerleme-raporu",
  "/proje",
  "/p",
  "/r",
] as const;

/** Herkese açık, oturumsuz ve otomatik iyileştirmeye uygun yol mu (S8 sözleşme testinin ön sürümü). */
export function isStaticEligiblePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") || path.includes("..")) return false;
  if (path !== "/" && path.endsWith("/")) return false;
  return !NEVER_STATIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
