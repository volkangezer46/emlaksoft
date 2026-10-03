"use client";

import { useId, useState, type ReactNode } from "react";

export type SerittSekme = { id: string; label: string; count?: number; panel: ReactNode };

/**
 * Sekmeli kart şeridi: paneller sunucuda üretilir, burada yalnız görünür olan seçilir
 * (istemci JS ~1 KB). Tek sekme varsa sekme çubuğu çizilmez; ok tuşlarıyla gezilir.
 */
export function SekmeSerit({ tabs, ariaLabel }: { tabs: SerittSekme[]; ariaLabel: string }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const uid = useId();
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!current) return null;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setActive(next.id);
    document.getElementById(`${uid}-${next.id}`)?.focus();
  };

  return (
    <div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={ariaLabel} className="pm-strip-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              id={`${uid}-${t.id}`}
              role="tab"
              type="button"
              aria-selected={t.id === current.id}
              aria-controls={`${uid}-panel`}
              tabIndex={t.id === current.id ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className="pm-strip-tab focus-ring"
            >
              {t.label}
              {t.count != null ? <span className="pm-strip-count">{t.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={tabs.length > 1 ? `${uid}-${current.id}` : undefined}>
        {current.panel}
      </div>
    </div>
  );
}
