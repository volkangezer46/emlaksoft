"use client";

import type { ReactNode } from "react";
import { Heart } from "lucide-react";
import { setFavMode, useFavMode, useFavorites } from "./favorites";
import { FavButton } from "./fav-button";
import { CompareToggle } from "./compare-select";
import type { CompareItem } from "./compare-table";

/**
 * Vitrin başlığındaki "Favorilerim (N)" chip'i — tx sekmeleriyle aynı satır,
 * koyu hero stili. Tıklanınca client tarafında yalnız favori kartlar kalır
 * (?fav=1 URL'e yazılır; SSR listesi aynen gelir, client süzer — SEO temiz).
 * Hiç favori yokken ve görünüm kapalıyken render edilmez.
 */
export function FavChip({ slug }: { slug: string }) {
  const favorites = useFavorites(slug);
  const favMode = useFavMode();
  if (favorites.length === 0 && !favMode) return null;

  return (
    <button
      type="button"
      aria-pressed={favMode}
      onClick={() => setFavMode(!favMode)}
      className={`focus-ring press inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
        favMode
          ? "bg-white text-ink-950"
          : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      <Heart className={`h-3.5 w-3.5 ${favMode ? "fill-red-500 text-red-500" : ""}`} />
      Favorilerim ({favorites.length})
    </button>
  );
}

/**
 * Favori görünümünde bu sayfada gösterilecek kart kalmadıysa görünen
 * boş durum — SSR grid'i client süzülünce sessizce boşalmasın.
 */
export function FavEmptyNotice({ slug, ids }: { slug: string; ids: string[] }) {
  const favorites = useFavorites(slug);
  const favMode = useFavMode();
  if (!favMode) return null;
  if (ids.some((id) => favorites.includes(id))) return null;

  return (
    <div className="mb-6 rounded-[20px] border border-dashed border-line bg-surface px-5 py-14 text-center">
      <Heart className="mx-auto h-8 w-8 text-text-faint" />
      <p className="mt-3 text-sm font-semibold text-ink-950">
        {favorites.length === 0 ? "Henüz favori ilanınız yok" : "Bu sayfada favori ilanınız görünmüyor"}
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Kartlardaki kalp ile beğendiğiniz ilanları kaydedin, sonra karşılaştırın.
      </p>
      <button
        type="button"
        onClick={() => setFavMode(false)}
        className="focus-ring press mt-4 inline-block rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
      >
        Tüm ilanları göster
      </button>
    </div>
  );
}

/**
 * Vitrin kartı kabuğu — sunucudan gelen kart Link'ini sarar:
 * - sağ üstte kalp (favori) + favorideyse karşılaştırma anahtarı;
 *   ikisi de overlay linkin üstünde (relative z-10), tık gezinmez.
 * - "Favorilerim" görünümünde favori olmayan kart client'ta gizlenir
 *   (hidden) — SSR çıktısı değişmez.
 */
export function VitrinCardShell({
  slug,
  item,
  children,
}: {
  slug: string;
  item: CompareItem;
  children: ReactNode;
}) {
  const favorites = useFavorites(slug);
  const favMode = useFavMode();
  const isFav = favorites.includes(item.id);

  return (
    <div className="relative" hidden={favMode && !isFav}>
      {children}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <FavButton slug={slug} propertyId={item.id} />
        {isFav ? <CompareToggle item={item} /> : null}
      </div>
    </div>
  );
}
