"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MorphTabFace, morphTabClass, type MorphIcon } from "@/components/ui/morph-tab-parts";
import { nextTabId } from "@/lib/form-tabs";
import { centerScrollLeft, tabDensity, type MorphBadge, type MorphOrientation } from "@/lib/morph-tabs";
import { cn } from "@/lib/utils";

/**
 * MorphTabs — büyüyen/küçülen sekmeler (ARIA tablist). Aktif sekme genişler (ikon + etiket [+ açıklama]),
 * pasifler ikona küçülür (erişilebilir ad ve `title` kalır). İki yön:
 *  - "horizontal": üst şerit (mobil dahil), aktif etiketli, pasifler ikon-only.
 *  - "vertical": ray; açıkken aktif genişler + pasifler ikon+etiket; `railCollapsed` ile TAMAMEN ikon-only
 *    (rozetler yine görünür), üzerine gelince/odaklanınca geçici genişler (flyout).
 * Klavye: yöne uygun oklar + Home/End, roving tabindex, odak = seçim. Sayfa/URL gezinmesi için
 * durumsuz `MorphNav` (morph-tab-parts.tsx) kullanılır. Animasyon CSS'tedir (premium.css).
 */

export type MorphTabItem = {
  id: string;
  label: string;
  icon?: MorphIcon;
  /** Yalnız dikeyde aktifken görünür. */
  description?: string;
  badge?: MorphBadge;
  /** 0..1; verilirse ikonda ilerleme halkası. */
  progress?: number | null;
  count?: number | null;
};

export function MorphTabs({
  items,
  activeId,
  onSelect,
  orientation,
  label,
  idPrefix,
  railCollapsed = false,
  onToggleRail,
  title,
  footer,
  inactive = "icon",
  className,
}: {
  items: MorphTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  orientation: MorphOrientation;
  /** tablist erişilebilir adı. */
  label: string;
  /** DOM id ön eki: sekme `${idPrefix}-tab-${id}`, panel `${idPrefix}-panel-${id}`. */
  idPrefix: string;
  /** Yalnız dikey. */
  railCollapsed?: boolean;
  onToggleRail?: () => void;
  /** Dikey ray başlığı. */
  title?: string;
  /** Dikey rayın altındaki içerik (ör. "2/3 bölüm tamam"). */
  footer?: ReactNode;
  /** Yalnız yatay: pasif sekmeler ikon-only ("icon") veya etiketli ("label", yatay kaydırılır). */
  inactive?: "icon" | "label";
  className?: string;
}) {
  const vertical = orientation === "vertical";
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState(false);
  const mounted = useRef(false);
  const collapsed = vertical && railCollapsed;
  const peeking = collapsed && peek;

  // Yatay şeritte aktif sekmeyi ortala (genişleme bitince tekrar: ölçü animasyonla değişir).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (vertical) return;
    const center = () => {
      const list = listRef.current;
      const el = refs.current[activeId];
      if (!list || !el) return;
      list.scrollTo({ left: centerScrollLeft(el.offsetLeft, el.offsetWidth, list.clientWidth) });
    };
    center();
    const t = window.setTimeout(center, 220);
    return () => window.clearTimeout(t);
  }, [activeId, vertical]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const prev = vertical ? "ArrowUp" : "ArrowLeft";
    const next = vertical ? "ArrowDown" : "ArrowRight";
    if (e.key !== prev && e.key !== next && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const key = e.key === prev ? "ArrowUp" : e.key === next ? "ArrowDown" : e.key;
    const target = nextTabId(
      items.map((i) => i.id),
      activeId,
      key as "ArrowUp" | "ArrowDown" | "Home" | "End",
    );
    onSelect(target);
    requestAnimationFrame(() => refs.current[target]?.focus());
  }

  function onPointerEnter(e: ReactPointerEvent) {
    if (e.pointerType === "mouse") setPeek(true);
  }
  function onFocusIn(e: FocusEvent<HTMLElement>) {
    if (e.target.matches(":focus-visible")) setPeek(true);
  }
  function onBlurOut(e: FocusEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setPeek(false);
  }

  const tablist = (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cn(
        "flex gap-1",
        vertical
          ? "flex-col"
          : "snap-x overflow-x-auto rounded-[var(--radius-card)] border border-line bg-canvas p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        !vertical && className,
      )}
    >
      {items.map((t) => {
        const active = t.id === activeId;
        const density = tabDensity({ active, orientation, railCollapsed: collapsed, peek: peeking, inactive });
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            title={density === "icon" ? t.label : undefined}
            aria-label={density === "icon" ? t.label : undefined}
            data-active={active}
            data-density={density}
            data-orient={orientation}
            onClick={() => onSelect(t.id)}
            className={cn(morphTabClass(vertical ? "rail" : "pill"), vertical ? "w-full" : "snap-start")}
          >
            {vertical && active ? (
              <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-600" />
            ) : null}
            <MorphTabFace
              icon={t.icon}
              label={t.label}
              description={t.description}
              progress={t.progress}
              badge={t.badge}
              count={t.count}
              active={active}
            />
          </button>
        );
      })}
    </div>
  );

  if (!vertical) return tablist;

  return (
    <div
      className="mt-rail rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--elev-1)]"
      data-rail={collapsed ? "collapsed" : "open"}
      data-peek={peeking ? "1" : undefined}
      onPointerEnter={collapsed ? onPointerEnter : undefined}
      onPointerLeave={collapsed ? () => setPeek(false) : undefined}
      onFocus={collapsed ? onFocusIn : undefined}
      onBlur={collapsed ? onBlurOut : undefined}
    >
      <div className={cn("flex min-h-11 items-center justify-between gap-1", (!collapsed || peeking) && "pl-2")}>
        {!collapsed || peeking ? (
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-text-faint">{title ?? "Bölümler"}</p>
        ) : null}
        {onToggleRail ? (
          <button
            type="button"
            onClick={onToggleRail}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Bölümler panelini genişlet" : "Bölümler panelini daralt"}
            title={collapsed ? "Genişlet" : "Daralt"}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted transition-colors duration-(--motion-fast) hover:bg-canvas hover:text-ink-950"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="h-4 w-4" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {tablist}
      {footer ? <div className="px-2 pb-1 pt-2">{footer}</div> : null}
    </div>
  );
}
