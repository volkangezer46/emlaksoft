"use client";

import { useEffect, useMemo, useState, startTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/app/actions/notifications";
import { filterByNotifPrefs, readNotifPrefs, type NotifPrefs } from "@/components/app/notification-prefs";

export function NotificationBell({ initial }: { initial: NotificationRow[] }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    setPrefs(readNotifPrefs());
  }, [open]);

  const visible = useMemo(() => {
    if (!prefs) return items;
    return items.filter((n) => filterByNotifPrefs(n.title, n.body, prefs));
  }, [items, prefs]);

  const unread = visible.filter((n) => !n.read_at).length;

  async function refresh() {
    const next = await listMyNotifications();
    startTransition(() => setItems(next));
  }

  async function onOpen() {
    setOpen((v) => !v);
    if (!open) await refresh();
  }

  async function onRead(id: string) {
    await markNotificationRead(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }

  async function onReadAll() {
    await markAllNotificationsRead();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className="relative grid h-10 w-10 place-items-center rounded-[11px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        aria-label="Bildirimler"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-danger-500" />
        ) : null}
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Kapat" className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-[340px] overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display text-sm font-bold text-ink-950">Bildirimler</p>
              {unread > 0 ? (
                <button type="button" onClick={onReadAll} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
                  <CheckCheck className="h-3.5 w-3.5" /> Tümünü oku
                </button>
              ) : null}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-text-muted">Bildirim yok.</p>
              ) : (
                visible.map((n) => {
                  const inner = (
                    <div className={`px-4 py-3 transition hover:bg-canvas ${n.read_at ? "opacity-70" : ""}`}>
                      <p className="text-sm font-semibold text-ink-950">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-xs text-text-muted">{n.body}</p> : null}
                      <p className="mt-1 text-[10px] text-text-faint">
                        {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(n.created_at))}
                      </p>
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
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => void onRead(n.id)}
                      className="block w-full border-b border-line text-left last:border-0"
                    >
                      {inner}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
