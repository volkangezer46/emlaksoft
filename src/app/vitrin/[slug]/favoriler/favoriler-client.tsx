"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, BedDouble, Building2, Heart, Loader2, MapPin, Ruler } from "lucide-react";
import { useFavorites } from "@/components/public/favorites";
import { FavButton } from "@/components/public/fav-button";
import type { VitrinFavItem } from "@/app/api/vitrin-favoriler/route";

/**
 * Favoriler sayfası gövdesi — id listesi localStorage'dan gelir
 * (useSyncExternalStore, hydration-güvenli), kart verisi public
 * /api/vitrin-favoriler ucundan çekilir (yalnız yayındaki ilanlar,
 * vitrinde zaten görünen alanlar). Kalp ile çıkarınca liste anında güncellenir.
 * ISR'a dokunmaz: sayfanın SSR kabuğu kişisel veri içermez.
 */

function money(n: number | null, tx?: string | null) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return tx === "rent" || (tx ?? "").toLowerCase().includes("kira") ? `${s}/ay` : s;
}

export function FavorilerClient({ slug }: { slug: string }) {
  const favorites = useFavorites(slug);
  const [items, setItems] = useState<VitrinFavItem[] | null>(null);
  const [error, setError] = useState(false);

  const favKey = favorites.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = favKey ? favKey.split(",") : [];
    // 0 favori: render zaten boş durumu gösteriyor — istek atmaya gerek yok
    // (setState de yok: react-hooks/set-state-in-effect).
    if (ids.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/vitrin-favoriler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, ids }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { items: VitrinFavItem[] };
        if (!cancelled) {
          setItems(data.items);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, favKey]);

  // Boş durum — hiç favori yok
  if (favorites.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-line bg-surface px-5 py-20 text-center">
        <Heart className="mx-auto h-8 w-8 text-text-faint" />
        <p className="mt-3 text-sm font-semibold text-ink-950">Henüz favori ilanınız yok</p>
        <p className="mt-1 text-xs text-text-muted">
          İlanlardaki kalp simgesiyle beğendiklerinizi kaydedin — bu cihazda saklanır, hesap gerekmez.
        </p>
        <Link
          href={`/vitrin/${slug}`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> İlanlara dön
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[20px] border border-dashed border-line bg-surface px-5 py-16 text-center">
        <p className="text-sm font-semibold text-ink-950">Favoriler yüklenemedi</p>
        <p className="mt-1 text-xs text-text-muted">Bağlantınızı kontrol edip sayfayı yenileyin.</p>
        <Link
          href={`/vitrin/${slug}`}
          className="mt-4 inline-block rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
        >
          İlanlara dön
        </Link>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="grid place-items-center rounded-[20px] border border-line bg-surface px-5 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        <p className="mt-3 text-xs text-text-muted">Favorileriniz yükleniyor…</p>
      </div>
    );
  }

  // Kalpten çıkarma anında yansısın: API yanıtı güncel favori listesiyle süzülür.
  const visible = items.filter((i) => favorites.includes(i.id));
  const unpublished = favorites.length - visible.length;

  return (
    <>
      {unpublished > 0 ? (
        <p className="mb-5 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
          {unpublished} favori ilan artık yayında değil — satılmış ya da yayından kaldırılmış olabilir.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line bg-surface px-5 py-20 text-center">
          <Heart className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 text-sm font-semibold text-ink-950">Favorilerinizden hiçbiri şu anda yayında değil</p>
          <p className="mt-1 text-xs text-text-muted">Vitrine dönüp güncel ilanlara göz atabilirsiniz.</p>
          <Link
            href={`/vitrin/${slug}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> İlanlara dön
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => {
            const loc = [p.district, p.province].filter(Boolean).join(", ");
            return (
              <div key={p.id} className="relative">
                <Link
                  href={`/vitrin/${slug}/${p.id}`}
                  className="lift group block overflow-hidden rounded-[18px] border border-line bg-surface transition hover:border-brand-300"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                    {p.coverId ? (
                      <Image
                        src={`/api/property-media/${p.coverId}`}
                        alt={p.title}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-text-faint">
                        <Building2 className="h-10 w-10" />
                      </div>
                    )}
                    {p.transactionType ? (
                      <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-[11px] font-bold uppercase text-white">
                        {p.transactionType}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                      <MapPin className="h-3.5 w-3.5 text-brand-600" /> {loc || "Konum belirtilmedi"}
                    </p>
                    <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                      {p.rooms ? (
                        <span className="flex items-center gap-1">
                          <BedDouble className="h-3.5 w-3.5" /> {p.rooms}
                        </span>
                      ) : null}
                      {p.sqm ? (
                        <span className="flex items-center gap-1">
                          <Ruler className="h-3.5 w-3.5" /> {p.sqm} m²
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 font-display text-xl font-extrabold text-brand-600">
                      {money(p.price, p.transactionType)}
                    </p>
                  </div>
                </Link>
                {/* Kalp — çıkarınca useFavorites tetiklenir, kart listeden düşer */}
                <div className="absolute right-3 top-3 z-10">
                  <FavButton slug={slug} propertyId={p.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
