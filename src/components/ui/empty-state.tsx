import Link from "@/components/ui/smart-link";
import { isValidElement, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Illustration, resolveIllustration, type IllustrationKind } from "./illustrations";

/**
 * EmptyState — projedeki TEK boş durum bileşeni (`EmptyStateV3` adı da buradan; eski `ui/empty-state-v3` silindi,
 * `components/app/empty-state` yalnız A ajanının dosyaları birleşene dek @deprecated yeniden dışa aktarımdır).
 *
 * Varyantlar:
 *  - "panel"   (varsayılan): sayfa/liste boşluğu — illüstrasyon + başlık + açıklama + eylem
 *  - "full":   daha küçük kesikli kart (kart/sekme içi)
 *  - "compact": başlık + açıklama (küçük kart içi)
 *  - "inline": tek satır
 *
 * `icon`: lucide bileşeni (`Users`) ya da hazır düğüm (`<Users />`) — ikisi de kabul.
 * `action` / `secondary`: hazır düğüm ya da `{ href, label, node }` nesnesi.
 * `help`: "nasıl çalışır?" yardım bağlantısı (varsa).
 * `illustration`: modül illüstrasyonu (`musteri`, `portfoy`...) ya da eski
 * `list|search|error|start`. Verilmezse ikon karosu gösterilir.
 */
type Tone = "brand" | "mint" | "amber" | "danger";
export type EmptyIllustration = IllustrationKind | "list" | "search" | "error" | "start";
type ActionObj = { href?: string; label?: string; node?: ReactNode };
type ActionProp = ReactNode | ActionObj;

const TILE: Record<Tone, { glow: string; tile: string }> = {
  brand: { glow: "bg-brand-600/20", tile: "bg-brand-600/10 text-brand-600" },
  mint: { glow: "bg-mint-500/20", tile: "bg-mint-500/12 text-mint-700" },
  amber: { glow: "bg-amber-400/20", tile: "bg-amber-400/16 text-amber-700" },
  danger: { glow: "bg-danger-500/15", tile: "bg-danger-500/10 text-danger-700" },
};

function isActionObj(a: ActionProp): a is ActionObj {
  return typeof a === "object" && a !== null && !isValidElement(a) && !Array.isArray(a);
}

function renderAction(a: ActionProp | undefined, kind: "primary" | "secondary"): ReactNode {
  if (a == null || a === false) return null;
  if (!isActionObj(a)) return a as ReactNode;
  if (a.node) return a.node;
  if (!a.href) return null;
  return (
    <Link
      href={a.href}
      className={
        kind === "primary"
          ? "btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
          : "focus-ring press surface-interactive inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border-interactive bg-surface px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-border-strong"
      }
    >
      {a.label}
    </Link>
  );
}

function renderIcon(icon: ComponentType<{ className?: string }> | ReactNode, cls: string): ReactNode {
  if (!icon) return null;
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon && !isValidElement(icon))) {
    const Icon = icon as ComponentType<{ className?: string }>;
    return <Icon className={cls} />;
  }
  return icon as ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  help,
  illustration,
  tone = "brand",
  variant = "panel",
  bare = false,
  className,
}: {
  icon?: ComponentType<{ className?: string }> | ReactNode;
  title: string;
  description?: string;
  action?: ActionProp;
  secondary?: ActionProp;
  /** "Nasıl çalışır?" yardım bağlantısı. */
  help?: { href: string; label?: string };
  illustration?: EmptyIllustration;
  tone?: Tone;
  variant?: "panel" | "full" | "compact" | "inline";
  /** `full`/`compact` içinde çerçevesiz (tablo/kart içine gömülü). */
  bare?: boolean;
  className?: string;
}) {
  const kind = resolveIllustration(illustration);

  if (variant === "inline") {
    return (
      <p role="status" className={cn("flex items-center gap-2 py-3 text-sm text-text-muted", className)}>
        {icon ? (
          <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
            {renderIcon(icon, "h-4 w-4")}
          </span>
        ) : null}
        <span>
          {title}
          {description ? <span className="text-text-faint"> · {description}</span> : null}
        </span>
        {action ? <span className="ml-auto shrink-0">{renderAction(action, "primary")}</span> : null}
      </p>
    );
  }

  const helpLink = help ? (
    <Link href={help.href} className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
      {help.label ?? "Nasıl çalışır?"}
    </Link>
  ) : null;
  const actions = (action || secondary || helpLink) ? (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
      {renderAction(action, "primary")}
      {renderAction(secondary, "secondary")}
      {helpLink}
    </div>
  ) : null;

  if (variant === "compact") {
    return (
      <div role="status" className={cn("flex flex-col items-center gap-1.5 px-4 py-6 text-center", className)}>
        {kind ? <Illustration kind={kind} tone={tone} size={84} /> : null}
        <p className="text-sm font-semibold text-text">{title}</p>
        {description ? <p className="max-w-md text-sm text-text-muted">{description}</p> : null}
        {actions}
      </div>
    );
  }

  if (variant === "full") {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-col items-center gap-3 px-6 py-12 text-center",
          !bare && "rounded-[var(--radius-card)] border border-dashed border-line bg-surface",
          className,
        )}
      >
        {kind ? (
          <Illustration kind={kind} tone={tone} size={104} />
        ) : icon ? (
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted [&>svg]:h-6 [&>svg]:w-6"
          >
            {renderIcon(icon, "h-6 w-6")}
          </span>
        ) : null}
        <p className="text-base font-semibold text-text">{title}</p>
        {description ? <p className="max-w-md text-sm text-text-muted">{description}</p> : null}
        {actions}
      </div>
    );
  }

  const t = TILE[tone];
  return (
    <div
      role="status"
      className={cn(
        "anim-rise relative grid place-items-center overflow-hidden rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center",
        className,
      )}
    >
      <div className={`pointer-events-none absolute -top-10 h-40 w-40 rounded-full blur-[70px] ${t.glow}`} />
      <div className="relative">
        {kind ? (
          <Illustration kind={kind} tone={tone} />
        ) : icon ? (
          <span aria-hidden="true" className={`mx-auto grid h-16 w-16 place-items-center rounded-[var(--radius-panel)] ${t.tile}`}>
            {renderIcon(icon, "h-8 w-8")}
          </span>
        ) : null}
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">{title}</h2>
        {description ? <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-muted">{description}</p> : null}
        {actions ? <div className="mt-4">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Eski v3 imzası: varsayılan varyant "full". */
export function EmptyStateV3(props: Parameters<typeof EmptyState>[0]) {
  return <EmptyState variant="full" {...props} />;
}
