"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { useFavorites } from "@/components/public/favorites";

/**
 * Vitrin üst gezinme "Favorilerim" rozeti — /vitrin/[slug]/favoriler sayfasına
 * gider, sayaç localStorage'dan gelir (useSyncExternalStore → hydration-güvenli:
 * SSR'da 0 görünür, hydrate sonrası gerçek sayı). `variant`:
 * - "dark": koyu hero şeridi (liste sayfası)
 * - "light": açık zemin (detay/favoriler sayfası üst satırı)
 */
export function FavNavBadge({ slug, variant = "light" }: { slug: string; variant?: "dark" | "light" }) {
  const favorites = useFavorites(slug);
  const count = favorites.length;

  const cls =
    variant === "dark"
      ? "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
      : "border border-line bg-surface text-text-muted hover:border-red-200 hover:text-red-500";

  return (
    <Link
      href={`/vitrin/${slug}/favoriler`}
      className={`focus-ring press inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${cls}`}
    >
      <Heart className={`h-3.5 w-3.5 ${count > 0 ? "fill-red-500 text-red-500" : ""}`} />
      Favorilerim
      {count > 0 ? (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
