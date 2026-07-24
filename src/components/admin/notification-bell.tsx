"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { markAllPlatformNotificationsRead, markPlatformNotificationRead } from "@/app/actions/platform-notifications";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

const KIND_META: Record<string, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: "bg-mint-500/12 text-mint-600" },
  warning: { icon: AlertTriangle, cls: "bg-amber-400/15 text-amber-600" },
  danger: { icon: AlertOctagon, cls: "bg-danger-500/10 text-danger-500" },
  system: { icon: Settings, cls: "bg-cyan-400/15 text-cyan-600" },
  info: { icon: Info, cls: "bg-brand-600/10 text-brand-600" },
};
function kindMeta(kind: string) {
  return KIND_META[kind] ?? KIND_META.info;
}

function relTime(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa`;
  const day = Math.floor(hr / 24);
  return `${day} gün`;
}

function groupByTime(items: Notif[]) {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekMs = 7 * 86_400_000;
  const groups: { label: string; items: Notif[] }[] = [
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

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.items ?? []);
      setUnread(json.unread ?? 0);
    } catch {
      /* sessiz */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const shown = tab === "unread" ? items.filter((n) => !n.read_at) : items;
  const groups = useMemo(() => groupByTime(shown), [shown]);

  const openItem = async (n: Notif) => {
    setOpen(false);
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await markPlatformNotificationRead(n.id);
    }
    if (n.href) router.push(n.href);
  };

  const markAll = async () => {
    setUnread(0);
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    await markAllPlatformNotificationsRead();
    router.refresh();
  };

  function renderItem(n: Notif) {
    const meta = kindMeta(n.kind);
    const Icon = meta.icon;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => openItem(n)}
        className={`flex w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-left transition hover:bg-canvas ${n.read_at ? "opacity-70" : "bg-brand-600/[0.04]"}`}
      >
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {!n.read_at ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" /> : null}
              <span className="truncate text-sm font-semibold text-ink-950">{n.title}</span>
            </span>
            <span className="shrink-0 text-[10px] text-text-faint">{relTime(n.created_at)}</span>
          </span>
          {n.body ? <span className="mt-0.5 block truncate text-[11px] text-text-muted">{n.body}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_24px_50px_-20px_rgba(10,34,71,0.5)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-ink-950">Bildirimler</p>
              {unread > 0 ? <span className="rounded-full bg-danger-500/10 px-1.5 py-0.5 text-[10px] font-bold text-danger-600">{unread} yeni</span> : null}
            </div>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Tümünü oku
              </button>
            ) : null}
          </div>

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

          <div className="max-h-[60vh] overflow-y-auto">
            {shown.length === 0 ? (
              <div className="grid place-items-center px-4 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-canvas text-text-faint"><BellOff className="h-6 w-6" /></span>
                <p className="mt-3 text-sm font-medium text-ink-950">{tab === "unread" ? "Okunmamış bildirim yok" : "Henüz bildirim yok"}</p>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <p className="sticky top-0 z-10 bg-canvas/90 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-text-faint backdrop-blur">{g.label}</p>
                  {g.items.map(renderItem)}
                </div>
              ))
            )}
          </div>

          <Link
            href="/admin/bildirimler"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-xs font-semibold text-brand-600 transition hover:bg-canvas"
          >
            Tüm bildirimleri gör
          </Link>
        </div>
      ) : null}
    </div>
  );
}
