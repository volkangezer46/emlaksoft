"use client";

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Command,
  LifeBuoy,
  Loader2,
  Search,
  Target,
  Users,
  X,
} from "lucide-react";
import { searchWorkspace, type SearchHit } from "@/app/actions/search";

const kindMeta: Record<SearchHit["kind"], { label: string; icon: typeof Users; tone: string }> = {
  customer: { label: "Müşteri", icon: Users, tone: "text-brand-600 bg-brand-600/10" },
  property: { label: "Portföy", icon: Building2, tone: "text-mint-600 bg-mint-500/12" },
  demand: { label: "Talep", icon: Target, tone: "text-cyan-600 bg-cyan-400/12" },
  ticket: { label: "Destek", icon: LifeBuoy, tone: "text-amber-600 bg-amber-400/15" },
};

export function CommandSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      setPending(false);
      return;
    }
    setPending(true);
    timer.current = setTimeout(async () => {
      const result = await searchWorkspace(value);
      startTransition(() => {
        setHits(result);
        setActive(0);
        setPending(false);
      });
    }, 180);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        queueMicrotask(() => inputRef.current?.focus());
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(hit.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          queueMicrotask(() => inputRef.current?.focus());
        }}
        className="relative flex w-full max-w-lg items-center rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-20 text-left text-sm text-text-faint transition hover:border-brand-300 hover:bg-surface"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <span>Müşteri, portföy, ilan no, ada-parsel ara…</span>
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-[7px] border border-line bg-surface px-2 py-1 text-[10px] text-text-faint sm:flex">
          <Command className="h-3 w-3" /> K
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/45 p-4 pt-[12vh] backdrop-blur-sm">
          <button type="button" aria-label="Kapat" className="absolute inset-0" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="h-4 w-4 text-text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  runSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((i) => Math.min(hits.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter" && hits[active]) {
                    e.preventDefault();
                    go(hits[active]!);
                  }
                }}
                placeholder="En az 2 karakter…"
                className="flex-1 bg-transparent py-4 text-sm outline-none"
                autoFocus
              />
              {pending ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : null}
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2">
              {q.trim().length < 2 ? (
                <p className="px-3 py-8 text-center text-sm text-text-muted">Müşteri, portföy kodu, oda tipi veya destek konusu yazın.</p>
              ) : hits.length === 0 && !pending ? (
                <p className="px-3 py-8 text-center text-sm text-text-muted">Sonuç bulunamadı.</p>
              ) : (
                <ul className="space-y-1">
                  {hits.map((hit, i) => {
                    const meta = kindMeta[hit.kind];
                    const Icon = meta.icon;
                    return (
                      <li key={`${hit.kind}-${hit.id}`}>
                        <button
                          type="button"
                          onClick={() => go(hit)}
                          onMouseEnter={() => setActive(i)}
                          className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
                            i === active ? "bg-brand-600/8" : "hover:bg-canvas"
                          }`}
                        >
                          <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${meta.tone}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink-950">{hit.title}</span>
                            <span className="block truncate text-xs text-text-muted">{meta.label} · {hit.subtitle}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
