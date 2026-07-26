"use client";

import { useEffect, useMemo, useState, startTransition } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  Info,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/app/actions/notifications";
import { filterByNotifPrefs, readNotifPrefs, type NotifPrefs } from "@/components/app/notification-prefs";
import { onNotificationInsert } from "@/lib/realtime";

const KIND_META: Record<string, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: "bg-mint-500/12 text-mint-600" },
  warning: { icon: AlertTriangle, cls: "bg-amber-400/15 text-amber-600" },
  danger: { icon: AlertOctagon, cls: "bg-danger-500/10 text-danger-500" },
  system: { icon: Settings, cls: "bg-violet-500/12 text-violet-600" },
  info: { icon: Info, cls: "bg-brand-600/10 text-brand-600" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? KIND_META.info;
}

/** Bildirimleri zaman dilimine göre grupla: Bugün / Bu hafta / Daha eski. */
function groupByTime(items: NotificationRow[]) {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekMs = 7 * 86_400_000;

  const groups: { label: string; items: NotificationRow[] }[] = [
    { label: "Bugün", items: [] },
    { label: "Bu hafta", items: [] },
    { label: "Daha eski", items: [] },
  ];
  for (const n of items) {
    const t = new Date(n.created_at).getTime();
    if (t >= dayStart.getTime()) groups[0].items.push(n);
    else if (now - t < weekMs) groups[1].items.push(n);
    else groups[2].items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

function relTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "şimdi";
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function NotificationBell({ initial }: { initial: NotificationRow[] }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [shake, setShake] = useState(false);

  // Canlı bildirim: RealtimeRefresh, notifications INSERT'lerini window event
  // olarak köprülüyor (tenant/user filtresi orada, RLS'li kanal — bkz.
  // src/lib/realtime.ts). Burada listeye anında ekle + zili bir kez salla.
  // Realtime kopuksa event gelmez; mevcut davranış (panel açılınca fetch +
  // soft refresh ile yeni `initial`) aynen sürer.
  useEffect(() => {
    return onNotificationInsert((row) => {
      setItems((prev) =>
        prev.some((n) => n.id === row.id)
          ? prev
          : [
              {
                id: row.id,
                title: row.title,
                body: row.body,
                href: row.href,
                kind: row.kind,
                read_at: row.read_at,
                created_at: row.created_at,
              },
              ...prev,
            ],
      );
      setShake(true);
    });
  }, []);

  // Elle kurulmuş popover: Escape ile kapanma (Radix'teki davranışın dengi).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Sunucudan yeni `initial` geldiğinde yerel listeyi tazele. Efekt yerine
  // React'in belgelediği "prop değişiminde render sırasında state ayarla"
  // deseni: fazladan commit + efekt turu yok, sonuç aynı.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setItems(initial);
  }

  const visible = useMemo(() => {
    if (!prefs) return items;
    return items.filter((n) => filterByNotifPrefs(n.title, n.body, prefs));
  }, [items, prefs]);

  const unread = visible.filter((n) => !n.read_at).length;
  const shown = tab === "unread" ? visible.filter((n) => !n.read_at) : visible;
  const groups = groupByTime(shown);

  // App Badge API: PWA yüklüyse ana ekran ikonunda okunmamış rozeti.
  // Desteklemeyen tarayıcılarda (typeof kontrolü) sessizce atlanır.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (unread > 0 && typeof nav.setAppBadge === "function") {
        void nav.setAppBadge(unread).catch(() => {});
      } else if (unread === 0 && typeof nav.clearAppBadge === "function") {
        void nav.clearAppBadge().catch(() => {});
      }
    } catch {
      // Rozet desteklenmiyor — görsel zil sayacı zaten var.
    }
  }, [unread]);

  async function refresh() {
    const next = await listMyNotifications();
    startTransition(() => setItems(next));
  }

  async function onOpen() {
    setOpen((v) => !v);
    if (!open) {
      // Tercihler localStorage'dan okunuyor; efekt yerine burada — panel
      // açılmadan değerine ihtiyaç yok ve olay içinde okumak daha doğrudan.
      setPrefs(readNotifPrefs());
      await refresh();
    }
  }

  async function onRead(id: string) {
    // Okunmuşa tekrar tıklanınca sunucuya boş yere yazma + revalidate olmasın.
    if (items.find((n) => n.id === id)?.read_at) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    await markNotificationRead(id);
  }

  async function onReadAll() {
    await markAllNotificationsRead();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  }

  function renderItem(n: NotificationRow) {
    const meta = kindMeta(n.kind);
    const Icon = meta.icon;
    const inner = (
      <div className={`flex gap-3 px-4 py-3 transition hover:bg-canvas ${n.read_at ? "opacity-60" : ""}`}>
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
            {!n.read_at ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" /> : null}
            <span className="truncate">{n.title}</span>
          </p>
          {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{n.body}</p> : null}
          <p className="mt-1 text-[11px] text-text-faint">{relTime(n.created_at)}</p>
        </div>
      </div>
    );
    return n.href ? (
      <Link
        key={n.id}
        href={n.href}
        onClick={() => {
          void onRead(n.id);
          setOpen(false);
        }}
        className="block border-b border-line last:border-0"
      >
        {inner}
      </Link>
    ) : (
      <button key={n.id} type="button" onClick={() => void onRead(n.id)} className="block w-full border-b border-line text-left last:border-0">
        {inner}
      </button>
    );
  }

  return (
    <div className="relative">
      {/* Yeni bildirimde zile tek seferlik küçük sallanma; hareket azaltma
          tercihinde kapalı. Global stile dokunmamak için bileşen içi <style>. */}
      <style>{`
        @keyframes es-bell-shake {
          0%, 100% { transform: rotate(0deg); }
          20% { transform: rotate(12deg); }
          40% { transform: rotate(-10deg); }
          60% { transform: rotate(6deg); }
          80% { transform: rotate(-3deg); }
        }
        .es-bell-shake { animation: es-bell-shake 0.55s ease-in-out 1; transform-origin: 50% 0%; }
        @media (prefers-reduced-motion: reduce) {
          .es-bell-shake { animation: none; }
        }
      `}</style>
      <button
        type="button"
        onClick={onOpen}
        className="relative grid h-10 w-10 place-items-center rounded-[11px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
      >
        <Bell className={`h-4 w-4${shake ? " es-bell-shake" : ""}`} onAnimationEnd={() => setShake(false)} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-white bg-danger-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Kapat" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="font-display text-sm font-bold text-ink-950">Bildirimler</p>
                {unread > 0 ? (
                  <span className="rounded-full bg-danger-500/10 px-1.5 py-0.5 text-[11px] font-bold text-danger-600">{unread} yeni</span>
                ) : null}
              </div>
              {unread > 0 ? (
                <button type="button" onClick={onReadAll} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
                  <CheckCheck className="h-3.5 w-3.5" /> Tümünü oku
                </button>
              ) : null}
            </div>

            {/* Sekmeler */}
            <div className="flex gap-1 border-b border-line px-2 py-1.5">
              {([
                { key: "all", label: "Tümü" },
                { key: "unread", label: `Okunmamış${unread > 0 ? ` (${unread})` : ""}` },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${tab === t.key ? "bg-brand-600/10 text-brand-600" : "text-text-muted hover:bg-canvas"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {shown.length === 0 ? (
                <div className="grid place-items-center px-4 py-12 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-canvas text-text-faint">
                    <BellOff className="h-6 w-6" />
                  </span>
                  <p className="mt-3 text-sm font-medium text-ink-950">{tab === "unread" ? "Okunmamış bildirim yok" : "Bildirim yok"}</p>
                  <p className="mt-0.5 text-xs text-text-muted">Yeni etkinlikler burada görünecek.</p>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.label}>
                    <p className="sticky top-0 z-10 bg-canvas/90 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint backdrop-blur">{g.label}</p>
                    {g.items.map(renderItem)}
                  </div>
                ))
              )}
            </div>

            {/* Arşiv: tüm bildirimlerin filtreli/sayfalı tam listesi */}
            <div className="border-t border-line">
              <Link
                href="/app/bildirimler"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-center text-xs font-semibold text-brand-600 transition hover:bg-canvas"
              >
                Tümünü gör
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
