"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Radar,
  Search,
  User,
  Users,
  Activity,
  BarChart3,
  CornerDownLeft,
  Handshake,
  Loader2,
} from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";

type Hit = {
  id: string;
  type: "tenant" | "member" | "ticket";
  title: string;
  subtitle: string;
  href: string;
};

type NavCmd = { label: string; href: string; icon: typeof LayoutDashboard; module: PlatformModule };

const ALL_NAV: NavCmd[] = [
  { label: "Kontrol paneli", href: "/admin", icon: LayoutDashboard, module: "dashboard" },
  { label: "Demo & aday", href: "/admin/satis", icon: Handshake, module: "sales" },
  { label: "Ofisler", href: "/admin/tenants", icon: Building2, module: "tenants" },
  { label: "Üyeler", href: "/admin/members", icon: Users, module: "members" },
  { label: "Abonelik & fatura", href: "/admin/billing", icon: CreditCard, module: "billing" },
  { label: "Destek talepleri", href: "/admin/tickets", icon: LifeBuoy, module: "tickets" },
  { label: "Aktivite kaydı", href: "/admin/aktivite", icon: Activity, module: "activity" },
  { label: "Raporlar", href: "/admin/raporlar", icon: BarChart3, module: "reports" },
  { label: "Coğrafya", href: "/admin/geo", icon: MapPin, module: "geo" },
  { label: "Sistem sağlığı", href: "/admin/sistem", icon: Radar, module: "sistem" },
];

const typeIcon = { tenant: Building2, member: User, ticket: LifeBuoy };
const typeLabel = { tenant: "Ofis", member: "Kullanıcı", ticket: "Destek talebi" };

export function CommandPalette({ modules }: { modules: PlatformModule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const navCmds = ALL_NAV.filter((n) => modules.includes(n.module));
  const filteredNav = q
    ? navCmds.filter((n) => n.label.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR")))
    : navCmds;

  // Sorgu 2 karakterin altındayken sunucu sonuçları gösterilmez. Bunu efektle
  // `hits`'i boşaltarak değil, türeterek yapıyoruz — state tek kaynak kalıyor.
  const shownHits = q.trim().length < 2 ? [] : hits;

  const flat = [
    ...filteredNav.map((n) => ({ kind: "nav" as const, ...n })),
    ...shownHits.map((h) => ({ kind: "hit" as const, ...h })),
  ];

  // `active` sonuç listesi küçüldüğünde taşabilir; efektle sıfırlamak yerine
  // okuma anında sınırlıyoruz.
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));

  // Kapanışta arama durumunu sıfırla. Tüm kapanış yolları buradan geçer,
  // böylece "open değişince efektte setState" desenine gerek kalmıyor.
  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (v) close();
          return !v;
        });
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (!cancelled) setHits(json.hits ?? []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) go(item.href);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-10 w-full items-center gap-3 rounded-[12px] border border-line bg-canvas/80 px-4 text-sm text-text-faint shadow-[var(--shadow-xs)] transition hover:border-brand-300/70 hover:bg-surface hover:text-text-muted hover:shadow-[var(--shadow-sm)]"
      >
        <Search className="h-4 w-4 shrink-0 transition group-hover:text-brand-500" />
        <span className="flex-1 truncate text-left text-[13px]">Ara… ofis, üye, destek talebi</span>
        <kbd className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-text-faint">
          Ctrl <span className="font-bold">K</span>
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-950/40 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_40px_90px_-30px_rgba(10,34,71,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4.5 w-4.5 text-text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                placeholder="Ofis, kullanıcı, destek talebi veya sayfa ara…"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink-950 outline-none placeholder:text-text-faint"
              />
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> : null}
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {filteredNav.length > 0 ? (
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint">Sayfalar</p>
              ) : null}
              {flat.map((item, i) => {
                const Icon = item.kind === "nav" ? item.icon : typeIcon[item.type];
                const isActive = i === activeIndex;
                const isFirstHit = item.kind === "hit" && (flat[i - 1]?.kind ?? "nav") === "nav";
                return (
                  <div key={`${item.kind}-${item.href}-${i}`}>
                    {isFirstHit ? (
                      <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint">Kayıtlar</p>
                    ) : null}
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(item.href)}
                      className={`flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition ${
                        isActive ? "bg-brand-600/8" : "hover:bg-canvas"
                      }`}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${
                          isActive ? "bg-brand-600/12 text-brand-600" : "bg-canvas text-text-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-950">
                          {item.kind === "nav" ? item.label : item.title}
                        </span>
                        {item.kind === "hit" ? (
                          <span className="block truncate text-[11px] text-text-faint">
                            {typeLabel[item.type]} · {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {isActive ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-text-faint" /> : null}
                    </button>
                  </div>
                );
              })}

              {q.trim().length >= 2 && !loading && flat.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-text-muted">“{q}” için sonuç yok.</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-line bg-canvas/50 px-4 py-2 text-[10px] text-text-faint">
              <span className="flex items-center gap-2">
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5">↑↓</kbd> gezin
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5">↵</kbd> aç
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5">Esc</kbd> kapat
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
