/**
 * /app 404 hedefi (SAF): adres bilinen bir listenin ALT yolu ise (silinmiş / olmayan kayıt) "listeye dön" hedefi
 * verilir; değilse (olmayan sayfa) yalnız ana ekran. `lists`: menü kataloğundaki iki parçalı yollar ve adları
 * (`/app/musteriler` → "Müşteriler"; sunucuda `NAV_PAGE_LABELS`'tan süzülür).
 */
export type NotFoundTarget =
  | { kind: "record"; listHref: string; listLabel: string }
  /** Alt yolları KAYIT değil SAYFA olan bölümde olmayan alt sayfa (ör. /app/ayarlar/yok): "Sayfa bulunamadı" + bölüme dönüş. */
  | { kind: "section"; sectionHref: string; sectionLabel: string }
  | { kind: "page" };

/** Alt yolları ayar/alt sayfa olan bölümler: buradaki olmayan yol silinmiş kayıt değil, olmayan sayfadır. */
const PAGE_SECTIONS = new Set(["ayarlar"]);

export function notFoundTarget(pathname: string, lists: readonly (readonly [string, string])[]): NotFoundTarget {
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts.length < 3) return { kind: "page" };
  const listHref = `/app/${parts[1]}`;
  const hit = lists.find(([href]) => href === listHref);
  if (PAGE_SECTIONS.has(parts[1]!)) return { kind: "section", sectionHref: listHref, sectionLabel: hit?.[1] ?? "Ayarlar" };
  return hit ? { kind: "record", listHref, listLabel: hit[1] } : { kind: "page" };
}
