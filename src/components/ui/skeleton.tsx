import { cn } from "@/lib/utils";

/**
 * Skeleton — yükleniyor iskeletleri (shimmer'lı).
 *
 * Sayfa ölçekli iskeletler (SkeletonDashboard, SkeletonList) ve parça ölçeğinde
 * yapı taşları (satır, metin bloğu, kart, tablo) tek burada; `components/app/skeleton.tsx`
 * yalnız geriye dönük re-export'tur. İkisi de aynı `.skeleton` CSS sınıfını
 * kullanır — parlama animasyonu tek yerden gelir ve `prefers-reduced-motion`
 * altında otomatik kapanır (bkz. globals.css "TASARIM SİSTEMİ v2" bloğu).
 *
 * ERİŞİLEBİLİRLİK: iskeletler dekoratiftir. Ekran okuyucuya "yükleniyor"
 * bilgisini TEK bir canlı bölge verir (`SkeletonBlock` sarmalayıcısı);
 * tekil parçalar `aria-hidden` ile ağaçtan çıkarılır, yoksa okuyucu onlarca
 * anlamsız kutu okur.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-[var(--radius-control)]", className)} />;
}

/**
 * Yükleniyor bölgesi sarmalayıcısı — içindeki iskeletleri tek bir erişilebilir
 * duyuruya bağlar. Veri gelince bileşen kaldırılır, duyuru da biter.
 */
export function SkeletonBlock({
  label = "Yükleniyor",
  className,
  children,
}: {
  /** Ekran okuyucuya okunacak metin (görsel olarak gizli) */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Çok satırlı metin iskeleti — son satır bilinçli olarak kısa (doğal görünür). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/5" : i % 2 === 0 ? "w-full" : "w-4/5")}
        />
      ))}
    </div>
  );
}

/** Avatar + iki satır — liste/tablo satırı bekleme hali. */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/5" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

/** KPI/StatCard ölçüsünde kart iskeleti — gerçek kartla aynı yükseklikte. */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius-panel)] border border-line bg-surface p-5", className)}>
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-[var(--radius-card)]" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-20" />
      <Skeleton className="mt-3 h-8 w-full rounded-md" />
    </div>
  );
}

/** Başlık + n satırlık tablo iskeleti. */
export function SkeletonTable({
  rows = 6,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface", className)}>
      <div
        className="grid gap-4 border-b border-line bg-canvas px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-line px-4 py-3.5 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-4/5" : "w-1/2")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-[var(--radius-card)]" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-20" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Kontrol paneli yükleniyor</span>
      <Skeleton className="h-40 rounded-[var(--radius-panel)]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
        <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <Skeleton className="h-4 w-1/2" />
            {Array.from({ length: 3 }).map((__, j) => (
              <SkeletonRow key={j} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Liste yükleniyor</span>
      <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="space-y-2.5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sayfa düzeni iskeletleri — gerçek PageHeader / Card / FilterBar ile */
/* aynı ızgara ve yükseklik (CLS=0 hedefi). Rota loading.tsx'leri bunları */
/* birleştirir; ölçüler burada, tek yerde.                              */
/* ------------------------------------------------------------------ */

/** PageHeader ile aynı kutu: başlık (32px) + açıklama (20px) + mb-6; sağda aksiyon. */
export function SkeletonPageHeader({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      {actions > 0 ? (
        <div className="flex shrink-0 gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Tek kartlı bölünmüş KPI şeridi (Card + divide-x). */
export function SkeletonKpiStrip({ cols = 4, className }: { cols?: 3 | 4; className?: string }) {
  return (
    <div
      className={cn(
        "grid divide-line rounded-[var(--radius-panel)] border border-line bg-surface sm:divide-x",
        cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="space-y-2 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** FilterBar: arama + filtre düğmesi satırı (h-10 kontroller). */
export function SkeletonFilterBar({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Skeleton className="h-10 min-w-48 flex-1" />
      <Skeleton className="h-10 w-24" />
      <Skeleton className="h-10 w-24" />
    </div>
  );
}

/** Kenarlıklı panel (bölüm kartı): başlık + n satır. */
export function SkeletonPanel({
  rows = 5,
  className,
  title = true,
}: {
  rows?: number;
  className?: string;
  title?: boolean;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {title ? <Skeleton className="h-5 w-40" /> : null}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** Sayfa kabuğu: erişilebilir tek duyuru + gerçek sayfayla aynı `space-y-6`. */
export function SkeletonPage({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <SkeletonBlock label={label} className="space-y-6">
      {children}
    </SkeletonBlock>
  );
}
