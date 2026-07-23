"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck } from "lucide-react";
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

const dotColor: Record<string, string> = {
  success: "bg-mint-500",
  info: "bg-brand-500",
  warning: "bg-amber-400",
  danger: "bg-danger-500",
  system: "bg-cyan-400",
};

function relTime(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa`;
  const day = Math.floor(hr / 24);
  return `${day} gün`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        aria-label="Bildirimler"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_24px_50px_-20px_rgba(10,34,71,0.5)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink-950">Bildirimler</p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu işaretle
              </button>
            ) : null}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto h-7 w-7 text-text-faint" />
                <p className="mt-2 text-sm text-text-muted">Henüz bildirim yok.</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-left transition hover:bg-canvas ${
                    n.read_at ? "" : "bg-brand-600/[0.04]"
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-line-strong" : dotColor[n.kind] ?? "bg-brand-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${n.read_at ? "font-medium text-ink-950" : "font-semibold text-ink-950"}`}>{n.title}</span>
                      <span className="shrink-0 text-[10px] text-text-faint">{relTime(n.created_at)}</span>
                    </span>
                    {n.body ? <span className="mt-0.5 block truncate text-[11px] text-text-muted">{n.body}</span> : null}
                  </span>
                  {n.read_at ? <Check className="mt-1 h-3 w-3 shrink-0 text-text-faint" /> : null}
                </button>
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
