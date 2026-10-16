"use client";

import Link from "@/components/ui/smart-link";
import { Lock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MORE_TRIGGER_CLASS, MoreTriggerFace, type MorphNavMoreItem } from "@/components/ui/morph-nav-more";

/** "Tümü" menüsünün Radix DropdownMenu gövdesi — morph-nav-more.tsx tarafından ilk etkileşimde yüklenir, açık gelir. */
export function MorphNavMoreMenu({ items, label, initialOpen }: { items: MorphNavMoreItem[]; label: string; initialOpen?: boolean }) {
  return (
    <DropdownMenu defaultOpen={initialOpen}>
      <DropdownMenuTrigger aria-label={`${label}: ${items.length} sekme daha`} title={`${items.length} sekme daha`} className={MORE_TRIGGER_CLASS}>
        <MoreTriggerFace count={items.length} />
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
