import { memo, type ComponentType, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Illustration, type IllustrationKind } from "@/components/ui/illustrations";
import { SkeletonCard } from "@/components/ui/viz/skeleton-card";
import type { PremiumTone } from "@/components/ui/premium/premium-math";

/* Recharts içermez — grafik paketinden bağımsız tutulur ki yalnız çerçeve isteyen sayfa recharts taşımasın. */

/**
 * ChartCard (= ChartFrame) — TEK grafik/panel kartı (tasarım sistemi v4, `.ds-card`).
 * Başlık şeridi: isteğe bağlı ikon karosu (`icon` + `tone`), başlık + alt başlık/dönem,
 * sağda `aside` (mini istatistik), `action` ve ayrıntı bağlantısı (`href`: sıfır çıkmaz metrik).
 * Gövde: `loading` → sabit yükseklikli iskelet (CLS yok); `empty` → anlamlı boş durum (gövde
 * çizilmez, sahte grafik yok). Eski kullanım (title, subtitle, action, children, className,
 * height) aynen çalışır; `height={0}` gövdeyi serbest yükseklikte bırakır.
 * `memo`: istemci kapısından (`lazy-charts`, `ui/chart`) çizildiğinde grafik veri/filtre state'i değişip
 * çerçeve prop'ları aynı kalınca başlık/çerçeve yeniden üretilmez (davranış değişmez; sunucudan da çizilir).
 */
export const ChartFrame = memo(function ChartFrame({
  title,
  subtitle,
  action,
  aside,
  icon: Icon,
  tone = "brand",
  as: Heading = "h3",
  children,
  className,
  height = 260,
  bodyClassName,
  period,
  href,
  hrefLabel = "Ayrıntı",
  loading = false,
  empty = false,
  emptyText = "Henüz veri yok",
  emptyIllustration = "rapor",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Başlık şeridinin sağında mini istatistik (ör. "ARPA ₺2.495"). */
  aside?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  /** Başlık düzeyi (sayfa yapısına göre; varsayılan h3). */
  as?: "h2" | "h3";
  children?: ReactNode;
  className?: string;
  /** Gövde yüksekliği (px); 0 = içerik kadar. */
  height?: number;
  /** Gövde kabı için ek sınıf (ör. kartı dolduran grafik: "flex flex-1 flex-col"). */
  bodyClassName?: string;
  /** Dönem etiketi (ör. "Son 30 gün"). */
  period?: string;
  /** Grafiğin ayrıntı/filtrelenmiş hedefi. */
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  emptyIllustration?: IllustrationKind;
}) {
  const sub = [subtitle, period].filter(Boolean).join(" · ");
  return (
    <section className={cn("ds-card ds-pad", className)}>
      <header className="ds-head mb-4">
        {Icon ? (
          <span className={`pm-ico pm-t-${tone}`} aria-hidden="true">
            <Icon />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <Heading className="ds-title" title={title}>{title}</Heading>
          {sub ? <p className="ds-sub mt-0.5" title={sub}>{sub}</p> : null}
        </div>
        {aside || action || href ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {aside}
            {action}
            {href ? (
              <Link href={href} className="ds-link focus-ring">
                {hrefLabel} <ArrowUpRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className={bodyClassName} style={height ? { height } : undefined}>
        {loading ? (
          <SkeletonCard height={height || 160} label={`${title} yükleniyor`} />
        ) : empty ? (
          <div className="grid h-full min-h-32 place-items-center text-center">
            <div>
              <Illustration kind={emptyIllustration} size={104} />
              <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">{emptyText}</p>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
});

export { ChartFrame as ChartCard };
