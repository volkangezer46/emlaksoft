"use client";

import { Heart } from "lucide-react";
import { toggleFavorite, useFavorites } from "./favorites";

/**
 * Vitrin kalp butonu — favoriye ekle/çıkar (localStorage, hesap gerektirmez).
 * Kart overlay linkinin İÇİNDE de kullanılabilir: tık gezinmeyi durdurur
 * (preventDefault + stopPropagation) ve `relative z-10` ile linkin üstünde kalır.
 * `label` verilirse metinli hap görünümü (ilan detayı), verilmezse yuvarlak ikon.
 */
export function FavButton({
  slug,
  propertyId,
  label = false,
  className = "",
}: {
  slug: string;
  propertyId: string;
  label?: boolean;
  className?: string;
}) {
  const favorites = useFavorites(slug);
  const active = favorites.includes(propertyId);
  const text = active ? "Favorilerden çıkar" : "Favorilere ekle";

  const shape = label
    ? `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
        active
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-line bg-surface text-text-muted hover:border-red-200 hover:text-red-500"
      }`
    : `grid h-9 w-9 place-items-center rounded-full border shadow-sm backdrop-blur ${
        active
          ? "border-red-200 bg-white text-red-500"
          : "border-white/40 bg-white/85 text-ink-950/60 hover:text-red-500"
      }`;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={text}
      title={text}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(slug, propertyId);
      }}
      className={`focus-ring press relative z-10 transition ${shape} ${className}`}
    >
      <Heart className={`h-4 w-4 transition ${active ? "fill-red-500 text-red-500" : ""}`} />
      {label ? <span>{active ? "Favoride" : "Favori"}</span> : null}
    </button>
  );
}
