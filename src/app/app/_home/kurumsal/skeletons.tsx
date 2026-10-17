/**
 * Ana ekran iskeletleri — BAĞIMLILIKSIZ sunucu modülü. `(bugun)/loading.tsx` bunları buradan alır: `blocks.tsx`/`views.tsx`
 * istemci adalarını (kahraman arama kutusu, kapsam anahtarı, görev kutusu…) içe aktardığı için onlardan alınırsa yükleme
 * sınırı aynı istemci modüllerini ikinci kez ilk yük paketine taşır. `views.tsx` ve `blocks.tsx` aynı adlarla yeniden dışa aktarır.
 */

export function CardSkeleton({ className = "", rows = 4, title = true }: { className?: string; rows?: number; title?: boolean }) {
  return (
    <div className={`kh-card kh-skel ${className}`} aria-hidden="true">
      {title ? (
        <div className="flex items-center gap-3">
          <span className="skeleton h-9 w-9 rounded-[var(--radius-control)]" />
          <span className="skeleton h-4 w-40 rounded-md" />
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i} className="skeleton block h-9 rounded-[var(--radius-control)]" style={{ width: `${100 - (i % 3) * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="kh-card kh-kpi kh-skel" aria-hidden="true">
      <span className="skeleton h-12 w-12 rounded-[var(--radius-control)]" />
      <div className="kh-kpi-main space-y-2">
        <span className="skeleton block h-3.5 w-24 rounded-md" />
        <span className="skeleton block h-7 w-28 rounded-md" />
        <span className="skeleton block h-4 w-14 rounded-md" />
      </div>
      <span className="kh-kpi-spark skeleton block h-10 rounded-md" />
    </div>
  );
}

export function KpiRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="kh-kpis" data-count={count}>
      {Array.from({ length: count }).map((_, i) => (
        <KpiSkeleton key={i} />
      ))}
    </div>
  );
}
