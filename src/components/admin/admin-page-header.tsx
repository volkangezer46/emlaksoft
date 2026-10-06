import type { LucideIcon } from "lucide-react";
import { DashboardHero } from "@/components/ui/dashboard-hero";

/**
 * Platform sayfa başlığı — tasarım sistemi v4: `DashboardHero` (açık, havadar zemin; sayfadaki TEK h1).
 *
 * Eskiden koyu "hero" şeridiydi (theme-dark + grad-ink + ızgara + glow) ve KPI ızgarası şeridin İÇİNDE koyu
 * kartlarla çiziliyordu. v4'te başlık açık banttır; `children` (KPI ızgarası, filtre çipleri) bandın ALTINDA
 * normal yüzeyde durur ve `KpiCard`/`KpiGrid` ile çizilir. API aynı kaldı (eski çağrılar değişmeden çalışır);
 * `glow` artık görsel etkisi olmayan geriye dönük bir parametredir.
 *
 * Şehir illüstrasyonu yalnız panel ana ekranında (/admin); alt sayfalarda sade bant (`art={false}`).
 */

export type HeroGlow = "amber" | "brand" | "mint" | "danger" | "cyan" | "none";

export function AdminPageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  /** Başlığın üstündeki küçük bölüm etiketi ("Ofis envanteri"). */
  eyebrow: string;
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Sağ üstte duran butonlar (dışa aktar, önizlemeyi bitir…). Açık zemine göre stillenmelidir. */
  actions?: React.ReactNode;
  /** Geriye dönük; görsel etkisi yok. */
  glow?: HeroGlow;
  /** Başlığın altına giren serbest içerik — KPI ızgarası, grafik, filtre çipleri. */
  children?: React.ReactNode;
}) {
  return (
    <>
      <DashboardHero
        art={false}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {eyebrow}
          </span>
        }
        title={title}
        summary={description}
        aside={actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : undefined}
      />
      {children ? <div className="-mt-2 [&>*:first-child]:mt-0">{children}</div> : null}
    </>
  );
}
