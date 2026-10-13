/**
 * Vitrin istemci adası kapısı (SAF, DOM'a yalnız verilen elemanla dokunur). Kapı modül düzeyinde TEK; gözlem ise ÖRNEK
 * BAŞINA: her bağlanan ada kendi işaret elemanını `watch` ile gözler, herhangi biri görünür alana 600 px yaklaşınca kapı
 * açılır ve bir daha kapanmaz. İstemci gezinmesinde (vitrin → ilan detayı, filtre sekmesi) eski eleman sökülür
 * (`watch` dönüşüyle gözlem biter), yeni sayfanın elemanı yeniden gözlenir; bekleyen React.lazy yükü böylece askıda kalmaz.
 */
export type ViewportGate = {
  /** Kapı açılınca çözülür (sunucuda hemen çözülmüş gelir). */
  released: Promise<void>;
  /** Elemanı gözle; dönen işlev gözlemi bırakır (useEffect temizliği). */
  watch: (el: Element | null) => () => void;
};

export const ISLAND_ROOT_MARGIN = "600px 0px";

export function createViewportGate(): ViewportGate {
  let open = typeof window === "undefined";
  let release: () => void = () => {};
  const released = open
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        release = () => {
          open = true;
          resolve();
        };
      });
  const noop = () => {};
  return {
    released,
    watch(el) {
      if (open) return noop;
      // Eleman yoksa ya da IntersectionObserver yoksa beklemeden aç (eski tarayıcı; ada asla boş kalmaz).
      if (!el || typeof IntersectionObserver === "undefined") {
        release();
        return noop;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            release();
          }
        },
        { rootMargin: ISLAND_ROOT_MARGIN },
      );
      io.observe(el);
      return () => io.disconnect();
    },
  };
}
