import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { HeroArt, type HeroArtKind } from "@/components/ui/illustrations/hero-art";

/**
 * Platform sayfa başlığı — tasarım sistemi v4: `DashboardHero` (açık, havadar zemin; sayfadaki TEK h1).
 *
 * `children` (KPI ızgarası, grafik kartları, filtre çipleri) bandın ALTINDA normal yüzeyde durur.
 * `art` verilirse başlık ile eylemler arasında konuya özel izometrik figür (`HeroArt`: ofis binası, kullanıcılar,
 * fatura, destek, kalkan, roket…) çizilir; `note` figürün yanında küçük bilgi kartıdır (gerçek veriden; sahte
 * pazarlama metni yazılmaz). API geriye uyumlu; `glow` görsel etkisi olmayan eski parametredir.
 */

export type HeroGlow = "amber" | "brand" | "mint" | "danger" | "cyan" | "none";

export function AdminPageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  art,
  note,
  children,
}: {
  /** Başlığın üstündeki küçük bölüm etiketi ("Ofis yönetimi"). */
  eyebrow: string;
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Sağ üstte duran butonlar (dışa aktar, önizlemeyi bitir…). Açık zemine göre stillenmelidir. */
  actions?: ReactNode;
  /** Konu figürü (lg+). */
  art?: HeroArtKind;
  /** Figür yanında kısa not (xl+); ör. "Son 30 günde 2 yeni ofis". */
  note?: ReactNode;
  /** Geriye dönük; görsel etkisi yok. */
  glow?: HeroGlow;
  /** Başlığın altına giren serbest içerik — KPI ızgarası, grafik, filtre çipleri. */
  children?: ReactNode;
}) {
  return (
    <>
      <DashboardHero
        art={art ? <HeroArt kind={art} /> : false}
        note={note}
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
