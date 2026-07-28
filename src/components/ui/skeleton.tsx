import { cn } from "@/lib/utils";

/**
 * Skeleton — yükleniyor iskeletleri (shimmer'lı).
 *
 * `components/app/skeleton.tsx` içindeki sayfa ölçekli iskeletler (dashboard,
 * liste) yerinde duruyor; burası PARÇA ölçeğinde ortak yapı taşlarını verir:
 * satır, metin bloğu, kart ve tablo. İkisi de aynı `.skeleton` CSS sınıfını
 * kullanır — parlama animasyonu tek yerden gelir ve `prefers-reduced-motion`
 * altında otomatik kapanır (bkz. globals.css "TASARIM SİSTEMİ v2" bloğu).
 *
 * ERİŞİLEBİLİRLİK: iskeletler dekoratiftir. Ekran okuyucuya "yükleniyor"
 * bilgisini TEK bir canlı bölge verir (`SkeletonBlock` sarmalayıcısı);
 * tekil parçalar `aria-hidden` ile ağaçtan çıkarılır, yoksa okuyucu onlarca
 * anlamsız kutu okur.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-[8px]", className)} />;
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
    <div className={cn("rounded-[18px] border border-line bg-surface p-5", className)}>
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-[12px]" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-20" />
      <Skeleton className="mt-3 h-8 w-full rounded-[6px]" />
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
    <div className={cn("overflow-hidden rounded-[16px] border border-line bg-surface", className)}>
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
