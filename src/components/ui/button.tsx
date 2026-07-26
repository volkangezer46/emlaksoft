import Link from "next/link";
import { Loader2 } from "lucide-react";
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

const SIZES = {
  sm: "h-8 gap-1.5 rounded-[8px] px-3 text-xs",
  md: "h-10 gap-2 rounded-[10px] px-4 text-sm",
  lg: "h-11 gap-2 rounded-[10px] px-5 text-sm",
} as const;

const BASE =
  "focus-ring press inline-flex items-center justify-center font-semibold transition disabled:pointer-events-none disabled:opacity-55";

type CommonProps = {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
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
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & ComponentProps<typeof Link>) {
  return (
    <Link className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {children}
    </Link>
  );
}
