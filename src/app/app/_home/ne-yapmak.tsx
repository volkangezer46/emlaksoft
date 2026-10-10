"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-core";

/** Komut paletini (üst çubuktakiyle AYNI palet) başlangıç metniyle açar; palet `detail.q` desteklemiyorsa yalnız açılır. */
function openPalette(q: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { q } }));
}

/**
 * Ana ekranın tek büyük kutusu: "Ne yapmak istiyorsun?". Tıklayınca ya da yazmaya başlayınca komut paleti açılır
 * (ikinci bir arama kutusu yok — yazılan metin palete devredilir). Altındaki çipler örnek ifadelerdir.
 */
export function NeYapmak({ chips }: { chips: string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Ne yapmak istiyorsun?" className="flex flex-col gap-3">
      <label className="relative block">
        <span className="sr-only">Ne yapmak istiyorsun?</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          autoComplete="off"
          placeholder="Ne yapmak istiyorsun?"
          onFocus={() => {
            openPalette("");
            ref.current?.blur();
          }}
          onChange={(e) => {
            const q = e.target.value;
            if (ref.current) ref.current.value = "";
            ref.current?.blur();
            openPalette(q);
          }}
          className="focus-ring h-14 w-full rounded-full border border-hairline bg-surface-raised pl-12 pr-5 text-base text-text shadow-[var(--elev-1)] placeholder:text-text-muted"
        />
      </label>
      <div className="flex flex-wrap gap-2" role="list" aria-label="Örnekler">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            role="listitem"
            onClick={() => openPalette(c)}
            className="focus-ring press inline-flex h-9 touch:h-11 items-center rounded-full border border-hairline bg-surface-raised px-4 text-sm font-medium text-text-muted shadow-[var(--elev-1)] transition hover:bg-surface-hover hover:text-text"
          >
            {c}
          </button>
        ))}
      </div>
    </section>
  );
}
