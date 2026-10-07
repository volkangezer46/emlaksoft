import Link from "@/components/ui/smart-link";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Button — merkezi buton hiyerarşisi.
 *
 * Her ekranın kendi inline buton reçetesini icat etmesini bitirir: press,
 * focus-ring, loading ve disabled davranışı tek yerden gelir. Gradient
 * yalnızca landing hero CTA'da kalır; panel içi primary düz brand-600'dür.
 *
 * `href` verilirse Link olarak render edilir (aynı görünüm, gezinme için).
 */
/* Premium düğme sistemi (2026-10-07; CSS `src/app/kit.css` .btn-*): degrade dolgu + üst iç parlama +
   basılı iç gölge, hover'da 1px yükselme (yalnız no-preference + hover:hover), pasif durumda sönük AMA
   okunur yüzey. API geriye uyumlu: eski varyant adları (primary/secondary/ghost/danger) ve boylar aynı.
   - primary: mavi degrade (sayfanın TEK birincil eylemi)   - navy: lacivert (satır içi kalıcı onay "Kaydet")
   - gold: yumuşak altın (premium an / "Ofise gir")          - outline: beyaz + ince kenar + gölge ("Yönet", dışa aktar)
   - secondary: eski ikincil (opak zemin, rol token'ları)    - ghost: saydam; danger: kırmızı degrade
   Dolgu --accent'tir (koyuda da beyaz yazı AA); hayalet/ikincil hover rol token'larından (tokens.css). */
const VARIANTS = {
  primary: "btn btn-primary",
  navy: "btn btn-navy",
  gold: "btn btn-gold",
  outline: "btn btn-outline",
  secondary:
    "surface-interactive border border-border-interactive bg-surface text-ink-950 hover:border-border-strong disabled:opacity-55",
  ghost: "text-text-muted hover:bg-surface-hover hover:text-ink-950 active:bg-surface-pressed disabled:opacity-55",
  danger: "btn btn-danger",
} as const;

/** Boy ölçeği. `xs` v2'de eklendi: tablo satırı içi aksiyonlar 32px'de bile iri
 *  duruyordu ve her ekran kendi `h-7 text-xs` reçetesini yazıyordu. `icon`: kare ikon düğmesi
 *  (⋮ menü, ↺ vazgeç) — erişilebilir ad `aria-label` ile ZORUNLU. */
const SIZES = {
  xs: "h-7 touch:h-11 gap-1 rounded-[var(--radius-control)] px-2.5 text-xs",
  sm: "h-8 touch:h-11 gap-1.5 rounded-[var(--radius-control)] px-3 text-xs",
  md: "h-9 touch:h-11 gap-2 rounded-[var(--radius-control)] px-4 text-sm",
  lg: "h-10 touch:h-11 gap-2 rounded-[var(--radius-control)] px-5 text-sm",
  icon: "h-8 w-8 touch:h-11 touch:w-11 rounded-[var(--radius-control)] p-0",
} as const;

/** İkon boyu boy ölçeğiyle birlikte büyür — elle `h-4 w-4` yazmaya gerek yok. */
const ICON_SIZES = {
  xs: "h-3.5 w-3.5",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-4 w-4",
  icon: "h-4 w-4",
} as const;

const BASE =
  // Pasif görünüm: .btn-* varyantlarında kit.css (sönük ama okunur yüzey), diğerlerinde opaklık.
  "focus-ring press inline-flex items-center justify-center font-semibold transition disabled:pointer-events-none";

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** Aynı görünüm düğme olmayan öğeye (ör. `<a>`, `<summary>`): `className={buttonClass({ variant: "outline" })}`. */
export function buttonClass({ variant = "primary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

type CommonProps = {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  /** Metnin solundaki ikon. Yükleniyorken spinner ile değiştirilir. */
  icon?: LucideIcon;
  /** Metnin sağındaki ikon (ör. ArrowUpRight ile "gider" anlatımı). */
  iconRight?: LucideIcon;
  children?: ReactNode;
};

/**
 * İkon + spinner yerleşimi — Button ve ButtonLink aynı düzeni paylaşsın diye.
 * Yükleniyorken sol ikon spinner'a döner; böylece buton genişliği zıplamaz.
 */
function Content({
  size,
  loading,
  icon: Icon,
  iconRight: IconRight,
  children,
}: Required<Pick<CommonProps, "size">> & Omit<CommonProps, "variant" | "size">) {
  const iconCls = ICON_SIZES[size];
  return (
    <>
      {loading ? (
        <Loader2 aria-hidden="true" className={cn(iconCls, "animate-spin")} />
      ) : Icon ? (
        <Icon aria-hidden="true" className={iconCls} />
      ) : null}
      {children}
      {/* Sağ ikon (çoğunlukla ok) hover/odakta 2px ileri kayar: motion.css `.icon-nudge`. */}
      {IconRight ? <IconRight aria-hidden="true" className={cn(iconCls, "icon-nudge")} /> : null}
    </>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: CommonProps & ComponentProps<"button">) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      // Yükleniyorken ekran okuyucu "meşgul" bilgisini alır; görsel spinner tek
      // başına bu bilgiyi taşımıyordu.
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      <Content size={size} loading={loading} icon={icon} iconRight={iconRight}>
        {children}
      </Content>
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  className,
  children,
  ...props
}: CommonProps & ComponentProps<typeof Link>) {
  return (
    <Link className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      <Content size={size} loading={loading} icon={icon} iconRight={iconRight}>
        {children}
      </Content>
    </Link>
  );
}
