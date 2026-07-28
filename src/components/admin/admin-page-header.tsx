import type { LucideIcon } from "lucide-react";

/**
 * Platform panelinin ortak koyu "hero" şeridi.
 *
 * NEDEN VAR: aynı 12 satırlık koyu blok (`theme-dark` + `grad-ink` + ızgara
 * kaplaması + renkli glow) `src/app/admin/**` altında on ayrı sayfada
 * kopyala-yapıştır duruyordu; ton, yuvarlaklık ve boşluk değerleri sayfadan
 * sayfaya kaymıştı. Tek bileşene toplandı — platform kimliği artık tek yerden
 * değişir.
 *
 * Server Component: hiçbir istemci durumu yok, `/admin` sayfalarından doğrudan
 * çağrılabilir.
 */

export type HeroGlow = "amber" | "brand" | "mint" | "danger" | "cyan" | "none";

const GLOW_CLS: Record<HeroGlow, string> = {
  amber: "bg-amber-400/20",
  brand: "bg-brand-500/25",
  mint: "bg-mint-500/20",
  danger: "bg-danger-500/22",
  cyan: "bg-cyan-400/20",
  none: "",
};

const EYEBROW_TONE: Record<HeroGlow, string> = {
  amber: "text-amber-300",
  brand: "text-brand-300",
  mint: "text-mint-400",
  danger: "text-danger-300",
  cyan: "text-cyan-300",
  none: "text-white/70",
};

export function AdminPageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  glow = "amber",
  children,
}: {
  /** Başlığın üstündeki küçük bölüm etiketi ("Ofis envanteri"). */
  eyebrow: string;
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Sağ üstte duran butonlar (dışa aktar, önizlemeyi bitir…). */
  actions?: React.ReactNode;
  glow?: HeroGlow;
  /** Başlığın altına giren serbest içerik — KPI ızgarası, grafik, filtre çipleri. */
  children?: React.ReactNode;
}) {
  return (
    <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
      {glow === "none" ? null : (
        <div className={`pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full blur-[90px] ${GLOW_CLS[glow]}`} />
      )}
      <div className="relative">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] ${EYEBROW_TONE[glow]}`}>
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {eyebrow}
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">{title}</h1>
            {description ? <p className="mt-1.5 max-w-2xl text-sm text-white/65">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
