"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  startTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  Calculator,
  CalendarDays,
  Command,
  Handshake,
  History,
  LifeBuoy,
  ListChecks,
  Loader2,
  Search,
  Settings,
  Sparkles,
  Target,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { searchWorkspace, type SearchHit } from "@/app/actions/search";
import { evaluatePaletteInput } from "@/lib/palette-calc";
import { useToast } from "@/components/app/toast-provider";

const kindMeta: Record<SearchHit["kind"], { label: string; icon: typeof Users; tone: string }> = {
  customer: { label: "Müşteri", icon: Users, tone: "text-brand-600 bg-brand-600/10" },
  property: { label: "Portföy", icon: Building2, tone: "text-mint-600 bg-mint-500/12" },
  demand: { label: "Talep", icon: Target, tone: "text-cyan-600 bg-cyan-400/12" },
  deal: { label: "Anlaşma", icon: Handshake, tone: "text-violet-600 bg-violet-500/12" },
  task: { label: "Görev", icon: ListChecks, tone: "text-amber-600 bg-amber-400/15" },
  ticket: { label: "Destek", icon: LifeBuoy, tone: "text-amber-600 bg-amber-400/15" },
};

// Boş palet durumu: sayfa navigasyonu kısayolları (ok tuşları + Enter da çalışır).
const QUICK_ACTIONS: { label: string; href: string; icon: typeof Users }[] = [
  { label: "Müşteriler", href: "/app/musteriler", icon: Users },
  { label: "Portföyler", href: "/app/portfoyler", icon: Building2 },
  { label: "Anlaşmalar", href: "/app/anlasmalar", icon: Handshake },
  { label: "Komisyon", href: "/app/komisyon", icon: Wallet },
  { label: "Raporlar", href: "/app/raporlar", icon: BarChart3 },
  { label: "Görevler", href: "/app/gorevler", icon: ListChecks },
  { label: "Randevular", href: "/app/randevular", icon: CalendarDays },
  { label: "Ayarlar", href: "/app/ayarlar", icon: Settings },
];

/* ------------------------------------------------------------------
   Son kullanılanlar — localStorage destekli küçük dış store,
   dashboard-widgets ile aynı desen: useSyncExternalStore ile okunur,
   SSR/ilk hydrate'te boş liste döner (palet zaten kapalı), açılınca
   gerçek liste gelir; hydration hatası üretmez.
   ------------------------------------------------------------------ */
type RecentKind = SearchHit["kind"] | "page";
type RecentItem = { label: string; href: string; kind: RecentKind };

const RECENTS_KEY = "palette_recents";
const MAX_RECENTS = 8;
const NO_RECENTS: RecentItem[] = [];

let recentsRaw: string | null = null;
let recentsCache: RecentItem[] = NO_RECENTS;
const recentsListeners = new Set<() => void>();

function readRecents(): RecentItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENTS_KEY);
  } catch {
    return recentsCache;
  }
  if (raw !== recentsRaw) {
    recentsRaw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      recentsCache = Array.isArray(parsed)
        ? parsed
            .filter(
              (x): x is RecentItem =>
                !!x &&
                typeof x === "object" &&
                typeof (x as RecentItem).label === "string" &&
                typeof (x as RecentItem).href === "string" &&
                typeof (x as RecentItem).kind === "string",
            )
            .slice(0, MAX_RECENTS)
        : NO_RECENTS;
    } catch {
      recentsCache = NO_RECENTS;
    }
  }
  return recentsCache;
}

function subscribeRecents(cb: () => void) {
  recentsListeners.add(cb);
  return () => recentsListeners.delete(cb);
}

function pushRecent(item: RecentItem) {
  const next = [item, ...readRecents().filter((r) => r.href !== item.href)].slice(0, MAX_RECENTS);
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(RECENTS_KEY, raw);
  } catch {
    // depolama kapalı/dolu — yalnız oturum içi çalışır
  }
  recentsRaw = raw;
  recentsCache = next;
  recentsListeners.forEach((l) => l());
}

function recentIcon(item: RecentItem): typeof Users {
  if (item.kind !== "page") return kindMeta[item.kind].icon;
  return QUICK_ACTIONS.find((a) => a.href === item.href)?.icon ?? History;
}

export function CommandSearch() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recents = useSyncExternalStore(subscribeRecents, readRecents, () => NO_RECENTS);

  const runSearch = useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    // Matematiksel ifade sunucuya gitmez: hesap satırı gösterilir.
    if (value.trim().length < 2 || evaluatePaletteInput(value) !== null) {
      setHits([]);
      setActive(0);
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
        setActive(0);
        queueMicrotask(() => inputRef.current?.focus());
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hesap makinesi: girdi matematiksel ifadeyse sonuç en üstte "= X" satırı.
  const calc = evaluatePaletteInput(q);
  const calcVisible = calc !== null;

  // Boş durumda son kullanılanlar + hızlı eylemler; klavye ve Enter o listede gezinir.
  const showQuick = !calcVisible && q.trim().length < 2;

  // AI Asistan satırı — arama metni varken listenin en altında görünür;
  // seçilince yazılan metin /app/asistan sayfasına ?q ile taşınır (ilk mesaj olur).
  const trimmed = q.trim();
  const askVisible = trimmed.length > 0;
  const askHref = `/app/asistan?q=${encodeURIComponent(trimmed)}`;

  // "Tüm sonuçları gör" — sonuç listesi doluyken en altta, AI satırının üstünde;
  // klavye navigasyonuna dahil. Hedef: /app/arama-sonuclari sayfası (yüksek limit).
  const allVisible = !calcVisible && !showQuick && hits.length > 0;
  const allHref = `/app/arama-sonuclari?q=${encodeURIComponent(trimmed)}`;

  // Gezinilebilir satır sırası: [hesap] → [son kullanılanlar → hızlı eylemler | sonuçlar] → [tüm sonuçlar] → [AI]
  const baseCount = calcVisible ? 1 : showQuick ? recents.length + QUICK_ACTIONS.length : hits.length;
  const allIndex = baseCount;
  const askIndex = baseCount + (allVisible ? 1 : 0);
  const maxIndex = baseCount + (allVisible ? 1 : 0) + (askVisible ? 1 : 0) - 1;

  function goHref(href: string) {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
    router.push(href);
  }

  // Seçilen kayıt/sayfa son kullanılanlara yazılır (max 8).
  function goRecent(item: RecentItem) {
    pushRecent(item);
    goHref(item.href);
  }

  function go(hit: SearchHit) {
    goRecent({ label: hit.title, href: hit.href, kind: hit.kind });
  }

  function copyCalc() {
    if (!calc) return;
    navigator.clipboard
      .writeText(calc.display)
      .then(() => toast.push(`${calc.display} panoya kopyalandı`))
      .catch(() => toast.push("Panoya kopyalanamadı", "err"));
  }

  function selectIndex(i: number) {
    if (calcVisible && i === 0) {
      copyCalc();
      return;
    }
    if (!calcVisible && showQuick) {
      if (i < recents.length && recents[i]) {
        goRecent(recents[i]!);
        return;
      }
      const qi = i - recents.length;
      const action = QUICK_ACTIONS[qi];
      if (action) {
        goRecent({ label: action.label, href: action.href, kind: "page" });
        return;
      }
    }
    if (!calcVisible && !showQuick && hits[i]) {
      go(hits[i]!);
      return;
    }
    if (allVisible && i === allIndex) {
      goHref(allHref);
      return;
    }
    if (askVisible && i === askIndex) goHref(askHref);
  }

  // Tüm sonuçlar satırı — sonuç listesi doluyken AI satırının hemen üstünde.
  const allRow = allVisible ? (
    <button
      type="button"
      onClick={() => goHref(allHref)}
      onMouseEnter={() => setActive(allIndex)}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
        allIndex === active ? "bg-brand-600/8" : "hover:bg-canvas"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] transition ${
          allIndex === active ? "bg-brand-600/10 text-brand-600" : "bg-canvas text-text-muted"
        }`}
      >
        <Search className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">
        Tüm sonuçları gör: &quot;{trimmed}&quot;
      </span>
    </button>
  ) : null;

  const askRow = askVisible ? (
    <button
      type="button"
      onClick={() => goHref(askHref)}
      onMouseEnter={() => setActive(askIndex)}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
        askIndex === active ? "bg-brand-600/8" : "hover:bg-canvas"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] transition ${
          askIndex === active ? "bg-brand-600/10 text-brand-600" : "bg-canvas text-text-muted"
        }`}
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">
        AI Asistan&apos;a sor: &quot;{trimmed}&quot;
      </span>
    </button>
  ) : null;

  // Hesap sonucu satırı — Enter/tık panoya kopyalar.
  const calcRow = calc ? (
    <button
      type="button"
      onClick={copyCalc}
      onMouseEnter={() => setActive(0)}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
        active === 0 ? "bg-brand-600/8" : "hover:bg-canvas"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] transition ${
          active === 0 ? "bg-brand-600/10 text-brand-600" : "bg-canvas text-text-muted"
        }`}
      >
        <Calculator className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold tabular-nums text-ink-950">= {calc.display}</span>
        <span className="block truncate text-xs text-text-muted">{calc.currency} · Enter panoya kopyalar</span>
      </span>
      <span className="ml-2 shrink-0 rounded-[6px] bg-brand-600/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-600">
        Hesap
      </span>
    </button>
  ) : null;

  return (
    /* Panel arama kutusuna bağlı açılıyor (admin paletiyle aynı desen).
       Öncesinde ekran ortasında modal olarak açılıp kutudan kopuk duruyordu. */
    <div className="relative w-full max-w-lg">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setActive(0);
          queueMicrotask(() => inputRef.current?.focus());
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="focus-ring relative flex w-full items-center rounded-[11px] border border-hairline bg-canvas py-2.5 pl-10 pr-20 text-left text-sm text-text-faint shadow-[var(--elev-1)] transition hover:border-brand-300 hover:bg-surface hover:shadow-[var(--elev-2)]"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <span className="truncate">Müşteri, portföy, anlaşma, görev, ilan no ara…</span>
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-[7px] border border-hairline bg-surface px-2 py-1 text-[11px] text-text-faint sm:flex">
          <Command className="h-3 w-3" /> K
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Aramayı kapat"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Hızlı arama"
            className="popover-in absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[16px] border border-hairline bg-surface shadow-[var(--inner-top),var(--elev-5)]"
          >
            <div className="hairline-b flex items-center gap-2 px-4">
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
                    setActive((i) => Math.min(maxIndex, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    selectIndex(active);
                  }
                }}
                placeholder="En az 2 karakter — ya da hesap: %2 5.400.000"
                className="flex-1 bg-transparent py-4 text-sm outline-none"
                autoFocus
              />
              {pending ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : null}
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
              {calcVisible ? (
                <div>
                  <p className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Hesap makinesi</p>
                  {calcRow}
                  {askRow ? <div className="mt-1 border-t border-line pt-1">{askRow}</div> : null}
                </div>
              ) : showQuick ? (
                <div>
                  {recents.length > 0 ? (
                    <>
                      <p className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Son kullanılanlar</p>
                      <ul className="space-y-1">
                        {recents.map((item, i) => {
                          const Icon = recentIcon(item);
                          const meta = item.kind !== "page" ? kindMeta[item.kind] : null;
                          return (
                            <li key={item.href}>
                              <button
                                type="button"
                                onClick={() => goRecent(item)}
                                onMouseEnter={() => setActive(i)}
                                className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
                                  i === active ? "bg-brand-600/8" : "hover:bg-canvas"
                                }`}
                              >
                                <span
                                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] transition ${
                                    i === active ? "bg-brand-600/10 text-brand-600" : "bg-canvas text-text-muted"
                                  }`}
                                >
                                  <Icon className="h-4 w-4" />
                                </span>
                                <span className="flex-1 truncate text-sm font-semibold text-ink-950">{item.label}</span>
                                {meta ? (
                                  <span className={`ml-2 shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${meta.tone}`}>
                                    {meta.label}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : null}
                  <p className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Hızlı eylemler</p>
                  <ul className="space-y-1">
                    {QUICK_ACTIONS.map((action, i) => {
                      const Icon = action.icon;
                      const idx = recents.length + i;
                      return (
                        <li key={action.href}>
                          <button
                            type="button"
                            onClick={() => goRecent({ label: action.label, href: action.href, kind: "page" })}
                            onMouseEnter={() => setActive(idx)}
                            className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition ${
                              idx === active ? "bg-brand-600/8" : "hover:bg-canvas"
                            }`}
                          >
                            <span
                              className={`grid h-9 w-9 place-items-center rounded-[10px] transition ${
                                idx === active ? "bg-brand-600/10 text-brand-600" : "bg-canvas text-text-muted"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="flex-1 truncate text-sm font-semibold text-ink-950">{action.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {askRow ? <div className="mt-1 border-t border-line pt-1">{askRow}</div> : null}
                  <p className="mt-1 border-t border-line px-3 py-2.5 text-center text-xs text-text-muted">
                    Kayıt aramak için en az 2 karakter yazın: müşteri, portföy, talep, anlaşma, görev, destek.
                  </p>
                </div>
              ) : hits.length === 0 && !pending ? (
                <div>
                  <p className="px-3 py-8 text-center text-sm text-text-muted">Sonuç bulunamadı.</p>
                  {askRow ? <div className="border-t border-line pt-1">{askRow}</div> : null}
                </div>
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
                            <span className="block truncate text-xs text-text-muted">{hit.subtitle}</span>
                          </span>
                          {/* Sonuç tipi rozeti */}
                          <span className={`ml-2 shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${meta.tone}`}>
                            {meta.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {allRow ? <li className="mt-1 border-t border-line pt-1">{allRow}</li> : null}
                  {askRow ? <li className={allRow ? "" : "mt-1 border-t border-line pt-1"}>{askRow}</li> : null}
                </ul>
              )}
            </div>

            {/* Klavye ipuçları çubuğu */}
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-text-faint">
              <span className="flex items-center gap-1">
                <kbd className="rounded-[5px] border border-hairline bg-canvas px-1 py-0.5 text-[10px]">↑↓</kbd> gezin
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded-[5px] border border-hairline bg-canvas px-1 py-0.5 text-[10px]">Enter</kbd>
                {calcVisible ? "kopyala" : "aç"}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded-[5px] border border-hairline bg-canvas px-1 py-0.5 text-[10px]">Esc</kbd> kapat
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
