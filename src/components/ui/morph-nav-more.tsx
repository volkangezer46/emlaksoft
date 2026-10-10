"use client";

import Link from "@/components/ui/smart-link";
import { ChevronDown, Lock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ReactNode } from "react";
import type { MorphNavItem } from "@/components/ui/morph-tab-parts";

/** Sunucudan gelen satır: ikon bileşeni yerine önceden çizilmiş öğe (RSC sınırında fonksiyon taşınamaz). */
export type MorphNavMoreItem = Omit<MorphNavItem, "icon"> & { iconNode?: ReactNode };

/**
 * Sekme şeridinde 5'ten fazla sekme olduğunda taşan sekmelerin "Diğer" menüsü.
 * Radix DropdownMenu: ok tuşları, Esc, odak dönüşü ve `aria-haspopup`/`aria-expanded` hazırdır.
 * Her satır gerçek bir bağlantıdır (yol ve yetki değişmez); 44px dokunma hedefi.
 */
export function MorphNavMore({ items, label }: { items: MorphNavMoreItem[]; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label}: ${items.length} sekme daha`}
        title={`${items.length} sekme daha`}
        className="focus-ring flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-ink-950 data-[state=open]:bg-surface-hover data-[state=open]:text-ink-950"
      >
        <span>Diğer</span>
        <span className="numeric rounded-full bg-canvas px-1.5 text-xs leading-5 text-text-muted" aria-hidden="true">+{items.length}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(24rem,70vh)] min-w-[13rem] overflow-y-auto">
        {items.map((item) => (
          <DropdownMenuItem key={item.id} asChild>
            <Link href={item.href} title={item.label}>
              {item.iconNode ?? null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.count != null ? <span className="numeric text-xs text-text-muted">{item.count}</span> : null}
              {item.locked ? <Lock className="text-amber-600" aria-label="Paketinize dahil değil" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
