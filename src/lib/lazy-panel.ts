import { lazy, type ComponentType } from "react";

/**
 * Kabuk panelleri için tembel yükleyici (kullanıcı menüsü, zil, komut paleti, hızlı oluştur).
 *
 * SORUN (ölçüldü, HIZ_OLCUM_RAPORU_5): parça boşta önceden indirilse bile `React.lazy` ilk render'da bir kez
 * askıya alınır (çözülmüş import da mikro görevde döner); React 19 askıdan dönen içeriği ~300 ms'lik gösterim
 * penceresine göre açar, ilk tık ~450-550 ms sürüyordu.
 * ÇÖZÜM: `preload()` bileşeni modül düzeyinde saklar; tık anında `resolve()` yüklenmiş GERÇEK bileşeni döndürür
 * (askıya alma yok, panel aynı karede açılır). Henüz yüklenmediyse eski `lazy` yoluna düşer (Suspense yedeği).
 * `resolve()` render içinde değil olay işleyicisinde çağrılır ve sonuç state'e yazılır (bileşen kimliği sabit kalır).
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = (): Promise<ComponentType<P>> => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // Ağ hatasında sonraki deneme yeniden indirebilsin.
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  const Lazy = lazy(() => preload().then((component) => ({ default: component })));

  return {
    /** Parçayı indir (boşta / hover / odak). Hata yutulur; tıkta `lazy` yolu yeniden dener. */
    preload: () => {
      preload().catch(() => undefined);
    },
    /** Tık anında: yüklendiyse gerçek bileşen (eşzamanlı), değilse `lazy` sarmalayıcı. */
    resolve: (): ComponentType<P> => loaded ?? Lazy,
  };
}
