import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { DataFreshness } from "@/components/ui/data-freshness";
import { HeroScene, type HeroSceneKind } from "@/components/ui/illustrations/hero-scenes";
import { SimpleHide, SimpleOverflow } from "@/components/ui/simple-kit";

/**
 * PageHeader — /app ve /admin için TEK sayfa başlığı (eski `ListHero` buraya katıldı; WP3).
 *
 * İki yoğunluk, tek dil:
 *  - `variant="plain"` (varsayılan): sakin başlık satırı (ayar, form, alt sayfa).
 *  - `variant="card"`: liste/merkez sayfalarının kart başlığı (`.ds-hero .lp-hero`), isteğe bağlı konu sahnesi (`art`).
 * Ortak kurallar: altın üst etiket (`eyebrow`), TEK başlık ölçeği (`.lp-hero-title`, list-page.css), eylemler TEK satırda —
 * birincil düğme `actions`, ikinciller `more` ile "Diğer" (…) menüsüne katlanır; geniş ekranda eylem satırı sarmaz.
 * Yalnız token kullanır (koyu temada otomatik uyum). Sunucu bileşenidir.
 *
 * TEK BİRİNCİL DÜĞME (sadeleştirme ilkesi 2): `actions` sayfanın tek dolu düğmesidir. Sade modda `more` "Diğer" menüsüne
 * katlanır, tam modda birincilin yanında satır içi kalır (`moreAlways`: her modda menüde). Menü paneli kapalıyken de
 * bağlıdır: içindeki düğmenin açtığı diyalog sökülmez. "Taze" damgası sade modda gizlidir.
 */
export type PageHeaderProps = {
  /** Başlık metni (bölge adı / erişilebilir ad). */
  title: string;
  /** Başlığın görünen içeriği `title`'dan farklıysa (ör. alt alanı izleyen istemci metni); h1 içinde çizilir. */
  titleNode?: ReactNode;
  description?: ReactNode;
  /** Başlığın üstünde küçük bağlam etiketi (ör. modül adı); altın ton. */
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Sağ üst: birincil düğme (ekranda TEK dolu düğme). */
  actions?: ReactNode;
  /** İkincil eylemler: sade modda "Diğer" (…) menüsünde, tam modda birincilin yanında. */
  more?: ReactNode;
  /** true: `more` tam modda da menüde durur. */
  moreAlways?: boolean;
  /** Başlığın yanında: rozet, sayaç vb. */
  meta?: ReactNode;
  /** Başlığın solunda: ikon veya avatar (yalnız `plain`). */
  icon?: ReactNode;
  /** "Son güncelleme SS:DD · Taze" damgası: true = bu istekte okundu, değer = verinin gerçek zamanı. */
  freshness?: boolean | string | number | Date;
  /** "card": liste/merkez kart başlığı; "plain": sakin satır. */
  variant?: "plain" | "card";
  /** Konu sahnesi (yalnız `card`); verilmezse sahne çizilmez, dar ekranda gizlenir. */
  art?: HeroSceneKind;
  className?: string;
  /** Başlık düzeyi: sayfada üstte başka bir h1 varsa "h2". */
  as?: "h1" | "h2";
};

function Freshness({ value, className }: { value: PageHeaderProps["freshness"]; className: string }) {
  if (!value) return null;
  return (
    <SimpleHide>
      <DataFreshness asOf={value === true ? undefined : value} className={className} />
    </SimpleHide>
  );
}

export function PageHeader({
  title,
  titleNode,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  more,
  moreAlways = false,
  meta,
  icon,
  freshness,
  variant = "plain",
  art,
  className,
  as: Heading = "h1",
}: PageHeaderProps) {
  const actionRow = (cls: string) =>
    actions || more ? (
      <div className={cls}>
        {actions}
        {more ? <SimpleOverflow always={moreAlways}>{more}</SimpleOverflow> : null}
      </div>
    ) : null;

  if (variant === "card") {
    return (
      <section className={cn("ds-hero lp-hero", className)} aria-label={title}>
        <div className="lp-hero-row">
          <div className="lp-hero-body">
            {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} className="mb-1.5" /> : null}
            {/* Masaüstünde görsel olarak gizli (sekme şeridiyle aynı bilgi; list-page.css), ekran okuyucu bağlamı olarak kalır. */}
            {eyebrow ? <p className="ds-eyebrow ph-eyebrow lp-eyebrow">{eyebrow}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Heading className="lp-hero-title">{titleNode ?? title}</Heading>
              {meta}
            </div>
            {description ? <div className="lp-hero-summary">{description}</div> : null}
            <Freshness value={freshness} className="mt-1" />
          </div>
          {art ? <HeroScene kind={art} className="lp-hero-art" /> : null}
          {actionRow("ph-actions lp-hero-actions")}
        </div>
      </section>
    );
  }

  return (
    // Eylemler BAŞLIK SATIRIYLA aynı hizada (breadcrumb/eyebrow üstte, açıklama altta tam genişlik); dar ekranda başlığın altına iner.
    <header className={cn("mb-5", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} className="page-crumb mb-2" /> : null}
      <div className={cn("min-w-0", icon ? "flex items-start gap-3" : undefined)}>
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="ds-eyebrow ph-eyebrow mb-1">{eyebrow}</p> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Heading className="lp-hero-title">{titleNode ?? title}</Heading>
              {meta}
            </div>
            {actionRow("ph-actions")}
          </div>
          {description ? <div className="mt-1 max-w-3xl text-sm text-text-muted">{description}</div> : null}
          <Freshness value={freshness} className="mt-1.5" />
        </div>
      </div>
    </header>
  );
}
