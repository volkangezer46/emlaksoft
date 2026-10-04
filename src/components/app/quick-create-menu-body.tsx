"use client";

import { KbdCombo } from "@/components/ui/kbd";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { getAppActions, type PaletteEntry } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";

/** Menü grupları: href → grup. Listede olmayan yeni eylem "Diğer"e düşer (kaybolmaz). */
const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: "Kayıtlar", hrefs: ["/app/hizli", "/app/musteriler/yeni", "/app/talepler/yeni", "/app/portfoyler/yeni", "/app/projeler/yeni", "/app/kiralama/yeni"] },
  { title: "Gün planı", hrefs: ["/app/randevular/yeni", "/app/gorevler/yeni", "/app/arama", "/app/acik-ev/yeni"] },
  { title: "Anlaşma", hrefs: ["/app/anlasmalar/yeni", "/app/teklifler/yeni", "/app/sozlesmeler/yeni", "/app/onaylar/yeni", "/app/portfoyler/sunumlar/yeni"] },
];

function groupEntries(entries: PaletteEntry[]) {
  const used = new Set<string>();
  const groups = GROUPS.map((g) => {
    const items = g.hrefs.flatMap((h) => entries.find((e) => e.href === h) ?? []);
    items.forEach((i) => used.add(i.href));
    return { title: g.title, items };
  });
  const rest = entries.filter((e) => !used.has(e.href));
  if (rest.length > 0) groups.push({ title: "Diğer", items: rest });
  return groups.filter((g) => g.items.length > 0);
}

/** Lazy gövde: kabuk tıklanınca yüklenir ve menü açık gelir. */
export function QuickCreateMenuBody({ creatableModules, lockedHrefs }: { creatableModules: AppModule[]; lockedHrefs: string[] }) {
  const closedModules = useClosedModules();
  const groups = groupEntries(getAppActions(creatableModules, "", lockedHrefs, closedModules));
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700"
          aria-label="Hızlı yeni kayıt menüsü"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Yeni</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[min(75vh,34rem)] w-72 overflow-y-auto">
        {groups.map((g, gi) => (
          <div key={g.title}>
            {gi > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{g.title}</DropdownMenuLabel>
            {g.items.map((a) => (
              <DropdownMenuItem key={a.href} asChild>
                <Link href={a.href}>
                  <a.icon aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  {a.shortcut ? (
                    <span className="ml-auto shrink-0" aria-label={`Kısayol ${a.shortcut}`}>
                      <KbdCombo keys={a.shortcut.split(" ")} className="uppercase" />
                    </span>
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
