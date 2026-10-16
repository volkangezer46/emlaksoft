"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { openPalette } from "@/lib/palette-events";

/**
 * Kahramandaki "Ne yapmak istiyorsun?" araması (P2-13): ikinci bir arama kutusu DEĞİL — üst çubuktaki AYNI komut
 * paletini açan düğme (Ctrl/⌘ K ile aynı). Çipler paletin anlayacağı örnek ifadelerdir (rol ve yetkiyle süzülmüş,
 * `ne-yapmak-chips.ts`); tıklayınca palet o metinle açılır. Bağımlılıksız olay modülü: istemci payı ~1 KB.
 */
export function HeroArama({ chips }: { chips: readonly string[] }) {
  return (
    <div className="kh-search-wrap">
      <Button variant="ghost" size="lg" className="kh-search" onClick={() => openPalette()} aria-label="Ne yapmak istiyorsun? Arama ve komut paletini aç">
        <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">Ne yapmak istiyorsun?</span>
        <kbd className="kh-kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </Button>
      {chips.length > 0 ? (
        <ul className="kh-search-chips" aria-label="Örnek aramalar">
          {chips.map((c) => (
            <li key={c}>
              <FilterChip onClick={() => openPalette(c)} aria-pressed={undefined}>
                {c}
              </FilterChip>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
