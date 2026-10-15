import { NAV_PAGE_LABELS } from "@/lib/nav-config";
import { NotFoundPanel } from "./_ui/not-found-panel";

/** "Listeye dön" hedefleri: menü kataloğundaki iki parçalı yollar (`/app/musteriler` → "Müşteriler"). Modül düzeyinde bir kez. */
const LISTS: readonly (readonly [string, string])[] = [...NAV_PAGE_LABELS].filter(([href]) => /^\/app\/[^/?#]+$/.test(href));

/**
 * /app 404 sınırı (B072): `notFound()` (silinmiş / olmayan kayıt) ve olmayan /app yolları (`[...yol]`) KABUK İÇİNDE çizilir;
 * menü yerinde kalır. Eskiden layout'taki özel hata sınırı notFound'u yutup menüsüz "Bir şeyler ters gitti" gösteriyor,
 * olmayan yol pazarlama 404'üne düşüyordu.
 */
export default function AppNotFound() {
  return <NotFoundPanel lists={LISTS} />;
}
