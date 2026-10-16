"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPalette } from "@/lib/palette-events";

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);

/**
 * Kahramandaki "Ne yapmak istiyorsun?" komut çubuğu (v4): ikinci bir arama motoru DEĞİL — yazılanı üst çubuktaki AYNI komut
 * paletine taşır (Enter ya da altın ok → `openPalette(metin)`; boşken palet boş açılır, Ctrl/⌘ K ile aynı). Yer tutucu rolün
 * ve yetkinin süzdüğü örnek ifadelerden kurulur (`ne-yapmak-chips.ts`: "Müşteri ekle, ilan ara, rapor al…"). Bağımlılıksız
 * olay modülü: istemci payı ~1 KB.
 */
export function HeroArama({ chips }: { chips: readonly string[] }) {
  const [q, setQ] = useState("");
  const hint = chips.length > 0 ? `${chips.map((c, i) => (i === 0 ? cap(c) : c)).join(", ")}…` : "Müşteri, ilan, görev ya da komut yazın…";
  return (
    <form
      role="search"
      className="kh-cmd"
      onSubmit={(e) => {
        e.preventDefault();
        openPalette(q.trim() || undefined);
        setQ("");
      }}
    >
      <Sparkles className="kh-cmd-ico h-5 w-5 shrink-0" aria-hidden="true" />
      <label className="sr-only" htmlFor="kh-cmd-input">
        Ne yapmak istiyorsun?
      </label>
      <input
        id="kh-cmd-input"
        className="kh-cmd-input"
        type="text"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="go"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Ne yapmak istiyorsun? ${hint}`}
      />
      <kbd className="kh-kbd" aria-hidden="true">
        Ctrl K
      </kbd>
      <Button type="submit" variant="gold" size="icon" className="kh-cmd-go" aria-label="Komut paletinde aç">
        <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
      </Button>
    </form>
  );
}
