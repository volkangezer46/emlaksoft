"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Mobil çekmece akordeon grubu (/app ve /admin ortak): kapalıyken tek satır başlık + öğe sayısı rozeti,
 * açıkken satırlar. Etkin sayfanın grubu (`locked`) hep açıktır ve kapatılamaz. Dokunma hedefi 44 px.
 */
export function DrawerGroup({
  id,
  title,
  count,
  expanded,
  locked = false,
  badge = 0,
  onToggle,
  children,
}: {
  /** Gruptaki bekleyen iş toplamı (kapalıyken uyarı rozeti). */
  badge?: number;
  id: string;
  title: string;
  /** Gruptaki satır sayısı (kapalıyken rozetle gösterilir). */
  count: number;
  expanded: boolean;
  locked?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={expanded}
        aria-controls={`drawer-grp-${id}`}
        className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 text-left text-xs font-semibold uppercase tracking-wide text-white/70 transition-colors hover:text-white disabled:cursor-default"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {!expanded && badge > 0 ? (
          <span className="nav-badge is-warn" aria-label={`${badge} bekleyen`}>
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {!expanded ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/10 px-1.5 text-xs font-bold tabular-nums text-white/80">{count}</span>
        ) : null}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
        <span className="sr-only">{expanded ? "bölümü daralt" : "bölümü aç"}</span>
      </button>
      {expanded ? (
        <div id={`drawer-grp-${id}`} className="space-y-0.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
