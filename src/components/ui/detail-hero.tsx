/* eslint-disable @next/next/no-img-element -- kapak/küçük resim korumalı medya ucundan (/api/property-media/…/thumb) gelir; ayrı next/image optimizasyonu gerekmez */
import type { ReactNode } from "react";
import { Building2, ChevronDown, ImageIcon, ImagePlus, type LucideIcon } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { HeroPhoto } from "@/components/ui/art/hero-photo";
import { buttonClass } from "@/components/ui/button";
import type { HeroPhotoId } from "@/lib/media/hero-photos";
import { cn } from "@/lib/utils";
import { heroChipClass, heroTitleClass, heroTitleText, splitHeroActions, DETAIL_HERO_MAX_ACTIONS } from "./detail-hero-logic";

export { heroChipClass, type HeroChipTone } from "./detail-hero-logic";

/**
 * DetailHero — her kayıt türünün (müşteri, portföy, anlaşma, kiralama, talep, kampanya…) TEK detay kahramanı.
 * Ultra premium dil (referans v5): lacivert derin zemin + seçilmiş fotoğraf atmosferi, koyu cam çipler, okunur cam
 * düğmeler, yumuşak gölge, 20 px köşe. SUNUCU BİLEŞENİ: istemci JS'i yok ("Daha fazla" yerel <details>), /app paketi büyümez.
 *
 * Yuvalar: `media` (baş harf / ikon / küçük resim) · `chips` (durum çipleri) · `title` + `meta` · `children` (gövde)
 * · `aside` (gösterge) · `actions` (en çok 4 görünür; kalanlar ve `more` "Daha fazla" menüsünde) · `footer` (tam genişlik
 * şerit: aşama hattı, KPI) · `compact` (yalnız telefonda: fiyat · durum · portal sayısı satırı).
 * `cover` verilirse yerleşim BÖLÜNMÜŞ olur: sağda kapak fotoğrafı, `aside` fotoğrafın üstünde cam kart (portföy).
 *
 * Sığma kuralları: başlık 2 satırda kesilir (`titleLines={1}` → tek satır + "…"), tam metin `title` ipucunda; eylem satırı
 * xl'de (1280+) tek satırdır, daha darda kırılabilir. Çocuk düğmeler `heroActionClass` / `buttonClass({variant:"glass"})` kullanır.
 */

/** Kahraman eylem düğmesi (cam). `primary`: satırın tek birincil eylemi (beyaz dolgu, lacivert metin). */
export function heroActionClass(kind: "secondary" | "primary" = "secondary", className?: string): string {
  if (kind === "primary") {
    return cn(
      "btn-shine focus-ring press inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] bg-white px-3.5 text-sm font-semibold text-[#0b1630] shadow-[0_10px_24px_-12px_rgb(0_0_0/0.65)] transition hover:bg-white/90 touch:min-h-11 [&>svg]:h-4 [&>svg]:w-4",
      className,
    );
  }
  return buttonClass({ variant: "onDark", size: "md", className: cn("shrink-0 whitespace-nowrap", className) });
}

export type DetailHeroMedia =
  | { kind: "avatar"; initials: string }
  | { kind: "icon"; icon: LucideIcon }
  /** Bağlı portföyün küçük resmi (anlaşma, kiralama). `src` yoksa bina ikonu. */
  | { kind: "thumb"; src: string | null; alt: string; href?: string };

export type DetailHeroCover = {
  /** Kapak fotoğrafı (geniş türev). null → fotoğraf yok kartı (`emptyHref` ile "Fotoğraf ekle"). */
  src: string | null;
  alt: string;
  /** Toplam fotoğraf sayısı (cam çip). */
  count?: number;
  /** Fotoğraflar sekmesi. */
  href?: string;
  emptyHref?: string;
};

export type DetailHeroProps = {
  title: string;
  /** Başlık boşsa gösterilecek metin. */
  titleFallback?: string;
  titleLines?: 1 | 2;
  eyebrow?: ReactNode;
  chips?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  media?: DetailHeroMedia;
  cover?: DetailHeroCover;
  /** Dekoratif atmosfer fotoğrafı (görsel kütüphanesi). Kapaklı yerleşimde kullanılmaz. */
  backdrop?: HeroPhotoId;
  aside?: ReactNode;
  actions?: ReadonlyArray<ReactNode>;
  more?: ReadonlyArray<ReactNode>;
  maxActions?: number;
  /** Eylem satırının id'si (mobil kayıt çubuğu bu satırı izler). */
  actionsId?: string;
  moreLabel?: string;
  footer?: ReactNode;
  compact?: ReactNode;
  className?: string;
};

const SHADOW = "shadow-[0_28px_60px_-34px_rgb(8_15_32/0.75),0_2px_6px_-2px_rgb(8_15_32/0.25)]";

function Media({ media }: { media: DetailHeroMedia }) {
  const box = "relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-surface)] md:h-16 md:w-16";
  if (media.kind === "avatar") {
    return (
      <span className={cn(box, "bg-[image:var(--grad-brand)] font-display text-lg font-extrabold text-white shadow-[var(--shadow-glow-brand)] md:text-xl")} aria-hidden>
        {media.initials}
      </span>
    );
  }
  if (media.kind === "icon") {
    const Icon = media.icon;
    return (
      <span className={cn(box, "border border-white/15 bg-white/10 text-white")} aria-hidden>
        <Icon className="h-6 w-6" />
      </span>
    );
  }
  const inner = media.src ? (
    <img src={media.src} alt={media.alt} width={160} height={120} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
  ) : (
    <Building2 className="h-6 w-6 text-white/70" aria-hidden />
  );
  const cls = cn(box, "border border-white/15 bg-white/10 shadow-[0_10px_24px_-14px_rgb(0_0_0/0.8)]");
  return media.href ? (
    <Link href={media.href} className={cn(cls, "focus-ring transition hover:border-white/35")} title={media.alt}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

function Cover({ cover, aside }: { cover: DetailHeroCover; aside?: ReactNode }) {
  return (
    <div className="relative isolate min-h-44 overflow-hidden rounded-[var(--radius-surface)] border border-white/10 bg-white/[0.04] max-lg:order-first sm:min-h-56 lg:min-h-[17.5rem]">
      {cover.src ? (
        <img
          src={cover.src}
          alt={cover.alt}
          width={1280}
          height={520}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <div aria-hidden className="absolute inset-0 opacity-30 grayscale">
            <HeroPhoto photo="site-cephe-gun-batimi" decorative sizes="(min-width: 1024px) 480px, 100vw" maxWidth={1280} />
          </div>
          <div className="absolute inset-0 grid place-items-center p-4">
            <div className="grid justify-items-center gap-2 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-white/10">
                <ImageIcon className="h-5 w-5 text-white/80" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-white/85">Kapak fotoğrafı yok</p>
              {cover.emptyHref ? (
                <Link href={cover.emptyHref} className={heroActionClass("secondary", "h-8 px-3 text-xs")}>
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden /> Fotoğraf ekle
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
      {/* Alt kenarda okunurluk örtüsü (cam kart ve çipler fotoğraf üstünde) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(8_15_32/0.78)_0%,rgb(8_15_32/0.2)_45%,rgb(8_15_32/0)_70%)]" />
      {cover.src && cover.count != null && cover.count > 0 ? (
        cover.href ? (
          <Link href={cover.href} className={cn(heroChipClass("neutral"), "focus-ring absolute left-3 top-3 bg-[rgb(8_15_32/0.55)] py-1.5 transition hover:bg-[rgb(8_15_32/0.75)]")}>
            <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {cover.count} fotoğraf
          </Link>
        ) : (
          <span className={cn(heroChipClass("neutral"), "absolute left-3 top-3 bg-[rgb(8_15_32/0.55)] py-1.5")}>
            <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {cover.count} fotoğraf
          </span>
        )
      ) : null}
      {aside ? (
        <div className="absolute inset-x-3 bottom-3 max-md:hidden">
          <div className="rounded-[var(--radius-surface)] border border-white/12 bg-[rgb(8_15_32/0.62)] p-3 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.8)]">{aside}</div>
        </div>
      ) : null}
    </div>
  );
}

export function DetailHero({
  title,
  titleFallback = "Başlıksız kayıt",
  titleLines = 2,
  eyebrow,
  chips,
  meta,
  children,
  media,
  cover,
  backdrop,
  aside,
  actions = [],
  more = [],
  maxActions = DETAIL_HERO_MAX_ACTIONS,
  actionsId,
  moreLabel = "Daha fazla",
  footer,
  compact,
  className,
}: DetailHeroProps) {
  const fullTitle = heroTitleText(title, titleFallback);
  const { visible, overflow } = splitHeroActions(actions, more, maxActions);
  const hasActions = visible.length > 0 || overflow.length > 0;
  const split = Boolean(cover);

  return (
    <section
      className={cn("detail-hero theme-dark relative isolate z-[3] rounded-[var(--radius-panel)] text-white", SHADOW, className)}>
      {/* Zemin katmanı ayrı (overflow-hidden yalnız burada): "Daha fazla" menüsü kahramanın dışına taşabilir. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit] bg-[image:var(--grad-ink)]">
        {backdrop && !split ? (
          <div className="absolute inset-y-0 right-0 w-full opacity-45 md:w-[68%]">
            <HeroPhoto photo={backdrop} decorative sizes="(min-width: 1024px) 720px, 100vw" maxWidth={1280} />
          </div>
        ) : null}
        {/* Soldan sağa koyu örtü: metin her zaman AA kontrastlı zeminde kalır. */}
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgb(8_15_32/0.97)_0%,rgb(8_15_32/0.9)_38%,rgb(8_15_32/0.55)_72%,rgb(8_15_32/0.35)_100%)] max-md:bg-[linear-gradient(180deg,rgb(8_15_32/0.82)_0%,rgb(8_15_32/0.94)_100%)]" />
        <div className="absolute inset-0 grid-overlay-dark opacity-25" />
        <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-600/25 blur-[90px]" />
      </div>

      <div
        className={cn(
          "relative grid gap-5 p-4 md:p-6",
          split ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-stretch" : aside ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center" : null,
        )}
      >
        <div className="flex min-w-0 items-start gap-4">
          {media ? <Media media={media} /> : null}
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="mb-1.5 truncate text-xs font-bold uppercase tracking-[0.14em] text-[#f6d58e]">{eyebrow}</p> : null}
            {chips ? <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div> : null}
            <h1 className={cn("font-display text-2xl font-extrabold leading-tight tracking-[-0.02em] text-white md:text-[1.875rem]", heroTitleClass(titleLines))} title={fullTitle}>
              {fullTitle}
            </h1>
            {meta ? <div className="mt-1.5 min-w-0 text-sm text-white/70">{meta}</div> : null}
            {children ? <div className="min-w-0">{children}</div> : null}
          </div>
        </div>
        {cover ? (
          <Cover cover={cover} aside={aside} />
        ) : aside ? (
          <div className="min-w-0 rounded-[var(--radius-surface)] border border-white/10 bg-white/[0.05] p-4 max-md:hidden">{aside}</div>
        ) : null}
      </div>

      {compact ? <div className="relative -mt-1 flex min-w-0 flex-wrap items-center gap-1.5 px-4 pb-4 md:hidden">{compact}</div> : null}

      {hasActions ? (
        <div className="relative border-t border-white/10 px-4 py-3 md:px-6">
          <div id={actionsId} className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap">
            {visible.map((node, i) => (
              <span key={i} className="contents">
                {node}
              </span>
            ))}
            {overflow.length > 0 ? (
              <details className="group/dh-more relative">
                <summary className={cn(heroActionClass("secondary"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                  {moreLabel}
                  <ChevronDown className="h-4 w-4 transition-transform group-open/dh-more:rotate-180" aria-hidden />
                </summary>
                <div className="absolute left-0 top-full z-40 mt-2 grid w-72 max-w-[calc(100vw-2.5rem)] gap-1.5 rounded-[var(--radius-surface)] border border-white/12 bg-[rgb(10_19_40/0.97)] p-2 shadow-[0_24px_50px_-18px_rgb(0_0_0/0.85)] [&>div>a]:w-full [&>div>a]:justify-start [&>div>button]:w-full [&>div>button]:justify-start">
                  {overflow.map((node, i) => (
                    <div key={i} className="min-w-0">
                      {node}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}

      {footer ? <div className="relative border-t border-white/10 px-4 py-4 md:px-6">{footer}</div> : null}
    </section>
  );
}

/** Kahramanın sağ/üst göstergesi için küçük satır (ikon + metin). */
export function HeroFact({ icon: Icon, tone = "text-mint-400", children }: { icon: LucideIcon; tone?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-white/75">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
