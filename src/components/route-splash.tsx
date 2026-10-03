/**
 * Ortak rota acilis ekrani. Kok `app/loading.tsx` kaldirildi: kok seviyedeki bir Suspense siniri,
 * 12.8 KB'tan buyuk statik sayfalari (ana sayfa, fiyatlar, yasal sayfalar) "once yedek, sonra
 * gizli bolum + $RC" bicimine ceviriyor ve icerik tum HTML inene kadar gorunmuyordu
 * (olcum: mobil LCP ana sayfa 4.5 sn -> 2.5 sn). Bu bilesen yalnizca dinamik kabuklarda
 * (/app, /admin layout'u ve token'li/dinamik public segmentler) kullanilir.
 */
export function RouteSplash() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex min-h-screen items-center justify-center bg-canvas">
      <span className="sr-only">Sayfa yükleniyor</span>
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center">
          <span aria-hidden="true" className="grid h-10 w-10 motion-safe:animate-pulse place-items-center rounded-[var(--radius-control)] bg-[image:var(--grad-brand)] font-display text-base font-extrabold text-white">
            E
          </span>
        </div>
        <div className="mx-auto mt-4 h-1 w-32 overflow-hidden rounded-full bg-line">
          <div aria-hidden="true" className="h-full w-1/2 motion-safe:animate-pulse rounded-full bg-[image:var(--grad-brand)]" />
        </div>
      </div>
    </div>
  );
}

export default RouteSplash;
