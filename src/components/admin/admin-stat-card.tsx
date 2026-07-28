import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/admin/count-up";

/**
 * Platform panelinin ortak KPI kartı.
 *
 * SÖZLEŞME (mimari kuralı "sıfır çıkmaz metrik"): görünen her sayı bir hedefe
 * götürür. `href` verilmezse kart tıklanamaz görünür — bu bilinçli bir tercih
 * olmalı, kaza değil; bu yüzden `href` opsiyonel ama `hint` ile "neden linksiz"
 * anlatılabiliyor.
 *
 * BOŞ DURUM: `value` `null` geldiğinde uydurma sıfır basılmaz; kart "veri yok"
 * kipine geçer ve `emptyHint` gösterir. Sahte sayı üretmek yasak.
 *
 * İki görünüm:
 *  - `tone="dark"`  → koyu hero şeridinin içinde (cam buton hissi)
 *  - `tone="light"` → normal sayfa yüzeyinde (surface kart)
 */
export function AdminStatCard({
  label,
  value,
  href,
  icon: Icon,
  tone = "light",
  accent,
  money,
  suffix,
  hint,
  emptyHint = "Veri yok",
  animate = true,
  children,
}: {
  label: string;
  /** `null` → "veri yok" kipi. Metin değer (durum etiketi) da kabul edilir. */
  value: number | string | null;
  href?: string | null;
  icon?: LucideIcon;
  tone?: "dark" | "light";
  /** İkon rengi — ör. "text-mint-400" (koyu) / "text-mint-600" (açık). */
  accent?: string;
  money?: boolean;
  suffix?: string;
  /** Sayının altındaki açıklama satırı. */
  hint?: React.ReactNode;
  emptyHint?: string;
  /** Sayaç animasyonu (yalnız sayısal değerlerde geçerli). */
  animate?: boolean;
  /** Sayının altına giren ek içerik — sparkline gibi. */
  children?: React.ReactNode;
}) {
  const dark = tone === "dark";
  const empty = value === null;

  const shell = dark
    ? "border-white/12 bg-white/8 backdrop-blur hover:border-white/25 hover:bg-white/12"
    : "border-line bg-surface hover:border-brand-300";

  const cls = [
    "group relative block rounded-[14px] border p-3.5 transition",
    shell,
    href ? "focus-ring press lift" : "",
  ].join(" ");

  const body = (
    <>
      {href ? (
        <ArrowUpRight
          className={`hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100 ${
            dark ? "text-white/40 group-hover:text-amber-300" : "text-text-faint group-hover:text-brand-600"
          }`}
        />
      ) : null}
      {Icon ? <Icon className={`h-4 w-4 ${accent ?? (dark ? "text-amber-300" : "text-brand-600")}`} /> : null}
      {empty ? (
        <p className={`mt-2 font-display text-xl font-extrabold ${dark ? "text-white/40" : "text-text-faint"}`}>—</p>
      ) : typeof value === "number" ? (
        <p className={`numeric mt-2 font-display text-xl font-extrabold tabular-nums ${dark ? "text-white" : "text-ink-950"}`}>
          {animate ? <CountUp value={value} money={money} suffix={suffix} /> : `${value}${suffix ?? ""}`}
        </p>
      ) : (
        <p className={`mt-2 font-display text-xl font-extrabold ${dark ? "text-white" : "text-ink-950"}`}>{value}</p>
      )}
      <p className={`text-[11px] ${dark ? "text-white/70" : "text-text-muted"}`}>{label}</p>
      {empty ? (
        <p className={`mt-1 text-[11px] font-medium ${dark ? "text-white/40" : "text-text-faint"}`}>{emptyHint}</p>
      ) : hint ? (
        <p className={`mt-1 text-[11px] font-medium ${dark ? "text-white/45" : "text-text-faint"}`}>{hint}</p>
      ) : null}
      {children}
    </>
  );

  if (!href) {
    return <div className={cls}>{body}</div>;
  }
  return (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}

/** KPI ızgarası — 2 sütun mobil, 4 sütun masaüstü (panel genelinde aynı ritim). */
export function AdminStatGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${className}`}>{children}</div>;
}
