"use client";

import { useId, useState, type ReactNode } from "react";

export type MediaTab = { id: string; label: string; count?: number; content: ReactNode };

/**
 * İlan medyası sekmeleri (Fotoğraflar · Kat planı): Rightmove/Zoopla deseni. İçerik sunucuda çizilir, burada yalnız
 * görünür sekme seçilir (gizli panel DOM'da kalır; sekme değişimi anında). Tek sekme varsa sekme şeridi çizilmez.
 * Ok tuşlarıyla sekmeler arasında gezilir (WAI-ARIA tabs deseni); dokunma hedefi ≥44 px.
 */
export function MediaTabs({
  tabs,
  label = "İlan medyası",
  tone = "light",
}: {
  tabs: MediaTab[];
  label?: string;
  /** "dark": koyu zeminli paylaşım sayfası. */
  tone?: "light" | "dark";
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const baseId = useId();
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0].content}</>;

  function focusTab(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    setActive(tab.id);
    document.getElementById(`${baseId}-tab-${tab.id}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className={`flex gap-1 border-b px-2 pt-2 ${tone === "dark" ? "border-white/10" : "border-line"}`}
      >
        {tabs.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              id={`${baseId}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  focusTab(i + 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  focusTab(i - 1);
                }
              }}
              className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-bold transition ${
                tone === "dark"
                  ? selected
                    ? "border-white text-white"
                    : "border-transparent text-white/65 hover:text-white"
                  : selected
                    ? "border-brand-600 text-ink-950"
                    : "border-transparent text-text-muted hover:text-ink-950"
              }`}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span
                  className={`rounded-full px-1.5 text-xs font-bold ${
                    tone === "dark" ? "bg-white/10 text-white/80" : "bg-ink-950/6 text-text-muted"
                  }`}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          id={`${baseId}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
