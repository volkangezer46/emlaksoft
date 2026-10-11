"use client";

import { Suspense, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { lazyPanel } from "@/lib/lazy-panel";
import type { MorphNavItem } from "@/components/ui/morph-tab-parts";

/** Sunucudan gelen satır: ikon bileşeni yerine önceden çizilmiş öğe (RSC sınırında fonksiyon taşınamaz). */
export type MorphNavMoreItem = Omit<MorphNavItem, "icon"> & { iconNode?: ReactNode };

/** Düğme sınıfı hafif kabukta ve Radix gövdesinde AYNI (yüklenince düğme sıçramaz). */
export const MORE_TRIGGER_CLASS =
  "focus-ring flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-ink-950 data-[state=open]:bg-surface-hover data-[state=open]:text-ink-950";

/** "Diğer +N" düğmesinin yüzü (hafif kabuk ve Radix tetikleyicisi ortak kullanır). */
export function MoreTriggerFace({ count }: { count: number }) {
  return (
    <>
      <span>Diğer</span>
      <span className="numeric rounded-full bg-canvas px-1.5 text-xs leading-5 text-text-muted" aria-hidden="true">+{count}</span>
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </>
  );
}

// Radix DropdownMenu gövdesi ilk etkileşime kadar yüklenmez; kabuk açıldıktan sonra boşta önceden iner.
const panel = lazyPanel(() => import("@/components/ui/morph-nav-more-menu").then((m) => m.MorphNavMoreMenu));

/**
 * Sekme şeridinde 5'ten fazla sekme olduğunda taşan sekmelerin "Diğer" menüsü (hafif kabuk).
 * Radix DropdownMenu gövdesi (`morph-nav-more-menu.tsx`): ok tuşları, Esc, odak dönüşü ve `aria-haspopup`/`aria-expanded`
 * hazırdır; ilk etkileşimde yüklenir ve açık gelir. Her satır gerçek bir bağlantıdır (yol ve yetki değişmez); 44px dokunma hedefi.
 */
export function MorphNavMore({ items, label }: { items: MorphNavMoreItem[]; label: string }) {
  const { Panel, open, warm } = useDeferredPanel(panel);
  const triggerProps: ComponentProps<"button"> = {
    "aria-label": `${label}: ${items.length} sekme daha`,
    title: `${items.length} sekme daha`,
    className: MORE_TRIGGER_CLASS,
  };
  const trigger = (
    <button type="button" onClick={open} onPointerEnter={warm} onFocus={warm} aria-haspopup="menu" aria-expanded={false} {...triggerProps}>
      <MoreTriggerFace count={items.length} />
    </button>
  );
  if (!Panel) return trigger;
  return (
    <Suspense fallback={trigger}>
      <Panel items={items} label={label} initialOpen />
    </Suspense>
  );
}
