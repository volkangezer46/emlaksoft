"use client";

import { financePath } from "@/lib/finance/routes";
import { KbdCombo } from "@/components/ui/kbd";
import Link from "@/components/ui/smart-link";
import { ChevronDown, Plus } from "lucide-react";
import { QUICK_CREATE_TRIGGER_CLASS } from "./quick-create-trigger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { mobileNewActions, splitNewActions } from "@/components/app/mobile-new-sheet";
import { useSimpleMode } from "@/lib/simple-mode";
import { getAppActions, type PaletteEntry } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";

/** Menü grupları: href → grup. Listede olmayan yeni eylem "Diğer"e düşer (kaybolmaz). */
const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: "Kayıtlar", hrefs: ["/app/hizli", "/app/musteriler/yeni", "/app/talepler/yeni", "/app/portfoyler/yeni", "/app/projeler/yeni", "/app/kiralama/yeni"] },
  { title: "Gün planı", hrefs: ["/app/randevular/yeni", "/app/gorevler/yeni", "/app/gelen-kutusu?sekme=cagri", "/app/acik-ev/yeni"] },
  { title: "Anlaşma", hrefs: ["/app/anlasmalar/yeni", "/app/teklifler/yeni", "/app/sozlesmeler/yeni", "/app/onaylar/yeni", "/app/portfoyler/sunumlar/yeni"] },
  { title: "Finans", hrefs: [financePath("kayit")] },
];

/**
 * Hızlı ekle menüsünde kısa adlar (izne bağlı: eylem `getAppActions` süzgecinden geçmediyse satır hiç yoktur).
 * "Yeni anlaşma" (commissions), "Teklif" (offers), "Gelir/Gider kaydı" (expenses).
 */
const MENU_LABELS: Record<string, string> = {
  "/app/anlasmalar/yeni": "Yeni anlaşma",
  "/app/teklifler/yeni": "Teklif",
  [financePath("kayit")]: "Gelir/Gider kaydı",
};

function groupEntries(entries: PaletteEntry[]) {
  const used = new Set<string>();
  const groups = GROUPS.map((g) => {
    const items = g.hrefs.flatMap((h) => {
      const hit = entries.find((e) => e.href === h);
      return hit ? [{ ...hit, label: MENU_LABELS[h] ?? hit.label }] : [];
    });
    items.forEach((i) => used.add(i.href));
    return { title: g.title, items };
  });
  const rest = entries.filter((e) => !used.has(e.href));
  if (rest.length > 0) groups.push({ title: "Diğer", items: rest });
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Lazy gövde: kabuk tıklanınca yüklenir ve menü açık gelir. Sade modda (plan 2.1) önce 6 sık eylem (mobil "+ Yeni" ile
 * aynı sıra), kalanı "Tümünü göster" ile gruplu açılır; tam modda gruplu tam liste.
 */
export function QuickCreateMenuBody({ creatableModules, lockedHrefs, role = null }: { creatableModules: AppModule[]; lockedHrefs: string[]; role?: string | null }) {
  const closedModules = useClosedModules();
  const simple = useSimpleMode();
  const [showAll, setShowAll] = useState(false);
  const entries = getAppActions(creatableModules, "", lockedHrefs, closedModules);
  const { primary } = splitNewActions(mobileNewActions(role, entries), simple);
  const folded = simple && !showAll && primary.length > 0;
  const restEntries = folded ? [] : entries;
  const groups = groupEntries(restEntries);
  const hiddenCount = entries.length - primary.length;
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={QUICK_CREATE_TRIGGER_CLASS}
          aria-label="Hızlı ekle menüsü"
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Yeni</span>
          <span className="qc-sep hidden sm:block" aria-hidden />
          <ChevronDown className="hidden h-4 w-4 opacity-80 sm:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[min(75vh,34rem)] w-72 overflow-y-auto">
        {folded ? (
          <>
            {primary.map((a) => (
              <DropdownMenuItem key={a.href} asChild>
                <Link href={a.href}>
                  <a.icon aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            {hiddenCount > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowAll(true);
                  }}
                >
                  <Plus aria-hidden />
                  Tümünü göster ({hiddenCount})
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}
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
