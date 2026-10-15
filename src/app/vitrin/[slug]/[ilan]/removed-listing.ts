import { cache } from "react";

/**
 * İlan detayı 404 bağlamı (SK8 B153): yayından kalkan (satılan/kiralanan/kapatılan) ya da bulunamayan ilanda sayfa
 * `notFound()` ile GERÇEK HTTP 404 döner; ama ziyaretçi EmlakSoft pazarlama 404'üne değil, ofis markalı "Bu ilan
 * yayından kalktı" görünümüne (vitrine dönüş, benzer ilanlar, talep formu) düşer.
 *
 * `not-found.tsx` rota parametresi almaz; bu yüzden sayfa bulduğu ofis bağlamını istek kapsamlı bu yuvaya yazar
 * (React `cache` = istek başına tek nesne) ve `not-found.tsx` aynı istekte buradan okur. Sayfa her yolda (normal
 * çizim, notFound, hata) yuvayı `finally` ile kapatır; okuyucu yine de kısa bir süre sınırıyla bekler (asılı kalmaz).
 */
export type RemovedListingSimilar = {
  id: string;
  /** Kanonik ilan yolu (`vitrinListingPath`). */
  href: string;
  title: string;
  price: string;
  tx: string | null;
  district: string | null;
  coverId: string | null;
};

export type RemovedListingCtx = {
  slug: string;
  office: string;
  logoUrl: string | null;
  brandColor: string | null;
  /** İlan ofiste var ama yayında değil (satıldı/kiralandı/kapatıldı) → true; hiç yoksa false. */
  removed: boolean;
  similar: RemovedListingSimilar[];
  leadToken: string | null;
  provinces: { id: string; name: string }[];
};

type Slot = {
  promise: Promise<RemovedListingCtx | null>;
  settle: (ctx: RemovedListingCtx | null) => void;
};

export const removedListingSlot = cache((): Slot => {
  let resolve: (ctx: RemovedListingCtx | null) => void = () => {};
  let settled = false;
  const promise = new Promise<RemovedListingCtx | null>((r) => {
    resolve = r;
  });
  return {
    promise,
    settle(ctx) {
      if (settled) return;
      settled = true;
      resolve(ctx);
    },
  };
});

/** not-found okuyucusu: sayfa yuvayı kapatana dek bekler; en çok `ms` (sonra genel görünüm). */
export function readRemovedListing(ms = 2500): Promise<RemovedListingCtx | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  return Promise.race([removedListingSlot().promise, timeout]).finally(() => clearTimeout(timer));
}
