import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Check, Lock } from "lucide-react";
import { formatBadgeCount, ringPercent, tabDensity, type MorphBadge, type MorphDensity } from "@/lib/morph-tabs";
import { cn } from "@/lib/utils";

/**
 * MorphTabs ortak görünüm parçaları — "use client" YOK: hem sunucu (DetailTabs) hem istemci
 * bileşenlerden (MorphTabs, SectionTabs) kullanılır. Durum/etkileşim `morph-tabs.tsx`'te;
 * burada yalnız yüz (ikon + etiket + rozet) ve bağlantı şeridi (MorphNav) vardır.
 * Animasyon CSS'tedir (`premium.css` "MorphTabs"): `data-density` ile sürülür.
 */

export type MorphIcon = ComponentType<{ className?: string }>;

/** Tek sekme düğmesinin ortak sınıfı: pill (modül içi şerit) veya rail (form rayı). */
export type MorphTabKind = "pill" | "rail" | "underline";

export function morphTabClass(kind: MorphTabKind): string {
  return cn(
    "mt-tab focus-ring relative flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] px-1 text-left text-sm font-medium text-text-muted transition-colors duration-(--motion-fast) hover:text-ink-950",
    kind === "rail" &&
      "hover:bg-surface-hover data-[active=true]:bg-surface-selected data-[active=true]:font-semibold data-[active=true]:text-brand-700",
    kind === "pill" &&
      "hover:bg-surface/70 data-[active=true]:bg-surface data-[active=true]:font-semibold data-[active=true]:text-ink-950 data-[active=true]:shadow-[var(--shadow-xs)]",
    // Alt çizgili şerit: aktif = ikon kapsülü + marka renkli alt çizgi (kapsül Face'te `capsule`).
    kind === "underline" &&
      "hover:bg-surface-hover data-[active=true]:font-semibold data-[active=true]:text-ink-950 after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-50 after:rounded-full after:bg-brand-600 after:opacity-0 after:transition-[opacity,transform] after:duration-(--motion-base) data-[active=true]:after:scale-x-100 data-[active=true]:after:opacity-100 motion-reduce:after:transition-none",
  );
}

export type MorphTabFaceProps = {
  icon?: MorphIcon;
  label: string;
  description?: string;
  /** Aktifken ikon halkası: 0..1 ilerleme (yalnız formlar verir). */
  progress?: number | null;
  badge?: MorphBadge;
  /** Gerçek veriden sayaç; null/undefined gösterilmez, 0 gösterilir. */
  count?: number | null;
  locked?: boolean;
  active: boolean;
  /** Aktifken ikon marka renkli kapsül içinde (alt çizgili şerit). */
  capsule?: boolean;
};

/** Sekmenin içi: ikon (+ rozet/halka) ve genişleyen etiket. Dış düğme/bağlantı çağırandadır. */
export function MorphTabFace({ icon: Icon, label, description, progress, badge, count, locked, active, capsule }: MorphTabFaceProps) {
  const ring = progress != null;
  const style = ring ? ({ "--mt-p": ringPercent(progress) } as CSSProperties) : undefined;
  const hasCount = count != null;
  return (
    <>
      <span
        className={cn("mt-ico transition-colors duration-(--motion-fast)", capsule && active && "bg-brand-600/10")}
        data-ring={ring ? "1" : undefined}
        style={style}
        aria-hidden="true"
      >
        {Icon ? <Icon className={cn("h-4 w-4", active && "text-brand-600")} /> : null}
        {badge?.kind === "error" ? (
          <span className="numeric absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-strong px-1 text-xs font-semibold leading-none text-white">
            {badge.text}
          </span>
        ) : badge?.kind === "complete" ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-success-strong text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        ) : badge?.kind === "missing" ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-warning-strong ring-2 ring-surface" />
        ) : null}
        {hasCount ? (
          <span className="mt-cnt-ovl numeric absolute -right-1.5 -top-1.5 h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-xs font-semibold leading-none text-white">
            {formatBadgeCount(count)}
          </span>
        ) : null}
        {locked ? <Lock className="absolute -bottom-0.5 -right-0.5 h-3 w-3 text-amber-600" /> : null}
      </span>
      <span className="mt-lw">
        <span className="mt-li py-1 pl-2 pr-2.5">
          <span className="block truncate leading-5">{label}</span>
          {description ? (
            <span className="mt-dw">
              <span>
                <span className="block whitespace-normal pt-0.5 text-xs font-normal leading-4 text-text-muted">{description}</span>
              </span>
            </span>
          ) : null}
        </span>
      </span>
      {hasCount ? (
        <span
          className={cn(
            "mt-lw-count numeric mr-2 h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-xs leading-none",
            active ? "bg-brand-600 font-semibold text-white" : "bg-canvas text-text-muted",
          )}
          aria-hidden="true"
        >
          {formatBadgeCount(count)}
        </span>
      ) : null}
      {badge?.label ? <span className="sr-only">, {badge.label}</span> : null}
      {hasCount ? <span className="sr-only">, {count} kayıt</span> : null}
      {locked ? <span className="sr-only">, Paketinize dahil değil</span> : null}
    </>
  );
}

export type MorphNavItem = {
  id: string;
  href: string;
  label: string;
  icon?: MorphIcon;
  count?: number | null;
  locked?: boolean;
};

/**
 * Bağlantı tabanlı (sayfa/`?sekme=` gezinmesi) MorphTabs şeridi: aktif genişler, pasifler ikona küçülür;
 * `inactive="auto"` geniş şeritte pasif etiketleri de gösterir. Durumsuzdur (sunucuda çizilebilir),
 * erişilebilirlik: `nav` + `aria-current`. Form sekmeleri için `MorphTabs` (ARIA tablist) kullanılır.
 */
export function MorphNav({
  items,
  activeId,
  label,
  scroll,
  inactive = "auto",
  variant = "pill",
  className,
  children,
}: {
  items: MorphNavItem[];
  activeId: string | null;
  label: string;
  /** `?sekme=` gibi aynı sayfa içi gezinmede false (kaydırma sıfırlanmasın). */
  scroll?: boolean;
  inactive?: "icon" | "auto";
  /** "pill": kapsül içinde segment (alt şerit); "underline": ikon kapsüllü + alt çizgili üst şerit. */
  variant?: "pill" | "underline";
  className?: string;
  /** Şeridin sonuna eklenen içerik (ör. sağda eylem). */
  children?: ReactNode;
}) {
  return (
    <nav aria-label={label} className={cn("mt-box", className)}>
      <ul
        data-idle={inactive}
        className={cn(
          "mt-strip relative flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          variant === "pill" ? "rounded-[var(--radius-card)] border border-line bg-canvas p-1" : "border-b border-line px-1 pt-1.5",
        )}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          const density: MorphDensity = tabDensity({ active, orientation: "horizontal", inactive: "icon" });
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={item.href}
                scroll={scroll}
                aria-current={active ? "page" : undefined}
                title={density === "icon" ? item.label : undefined}
                aria-label={density === "icon" ? item.label : undefined}
                data-active={active}
                data-density={density}
                data-orient="horizontal"
                className={morphTabClass(variant)}
              >
                <MorphTabFace
                  icon={item.icon}
                  label={item.label}
                  count={item.count}
                  locked={item.locked}
                  active={active}
                  capsule={variant === "underline"}
                />
              </Link>
            </li>
          );
        })}
        {children}
      </ul>
    </nav>
  );
}
