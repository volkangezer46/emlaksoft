/**
 * /app 404 hedefi (SAF): adres bilinen bir listenin ALT yolu ise (silinmiş / olmayan kayıt) "listeye dön" hedefi
 * verilir; değilse (olmayan sayfa) yalnız ana ekran. `lists`: menü kataloğundaki iki parçalı yollar ve adları
 * (`/app/musteriler` → "Müşteriler"; sunucuda `NAV_PAGE_LABELS`'tan süzülür).
 */
export type NotFoundTarget =
  | { kind: "record"; listHref: string; listLabel: string }
  | { kind: "page" };

export function notFoundTarget(pathname: string, lists: readonly (readonly [string, string])[]): NotFoundTarget {
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts.length < 3) return { kind: "page" };
  const listHref = `/app/${parts[1]}`;
  const hit = lists.find(([href]) => href === listHref);
  return hit ? { kind: "record", listHref, listLabel: hit[1] } : { kind: "page" };
}
