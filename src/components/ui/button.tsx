import Link from "next/link";
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
const VARIANTS = {
  primary:
    "bg-brand-600 text-white shadow-[var(--inner-top-dark)] hover:bg-brand-700",
  secondary:
    "border border-hairline-strong bg-surface text-ink-950 hover:bg-canvas",
  ghost: "text-text-muted hover:bg-canvas hover:text-ink-950",
  danger: "bg-danger-500 text-white hover:bg-danger-600",
} as const;

/** Boy ölçeği. `xs` v2'de eklendi: tablo satırı içi aksiyonlar 32px'de bile iri
 *  duruyordu ve her ekran kendi `h-7 text-[11px]` reçetesini yazıyordu. */
const SIZES = {
  xs: "h-7 gap-1 rounded-[8px] px-2.5 text-[11px]",
  sm: "h-8 gap-1.5 rounded-[8px] px-3 text-xs",
  md: "h-10 gap-2 rounded-[10px] px-4 text-sm",
  lg: "h-11 gap-2 rounded-[10px] px-5 text-sm",
} as const;

/** İkon boyu boy ölçeğiyle birlikte büyür — elle `h-4 w-4` yazmaya gerek yok. */
const ICON_SIZES = {
  xs: "h-3.5 w-3.5",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-4 w-4",
} as const;

const BASE =
  "focus-ring press inline-flex items-center justify-center font-semibold transition disabled:pointer-events-none disabled:opacity-55";

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
      {IconRight ? <IconRight aria-hidden="true" className={iconCls} /> : null}
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
