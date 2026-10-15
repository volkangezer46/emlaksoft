"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type ComponentProps } from "react";
import { Bell } from "lucide-react";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import { isAdminRealtimeLive, onAdminNotification } from "@/hooks/use-admin-realtime";

/** Yedek yoklama aralığı: yalnız canlı kanal katılı DEĞİLKEN çalışır (canlıyken bildirim olayla anında gelir). */
export const BELL_FALLBACK_POLL_MS = 60_000;

export type Notif = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

// Açılır panel (liste, gruplama, okundu işaretleme) ilk yük paketine girmez: boşta önceden iner, zile gelince
// (hover/odak) ısınır; tık anında yüklüyse aynı karede açılır (`lazyPanel`). Okunmamış rozeti ve yoklama zildedir.
type PanelProps = ComponentProps<typeof import("./notification-bell-panel").NotificationPanel>;
const panel = lazyPanel<PanelProps>(() => import("./notification-bell-panel").then((m) => m.NotificationPanel));

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const ref = useRef<HTMLDivElement>(null);

  // Durum güncellemeleri bilinçli olarak `.then()` içinde: `async/await`
  // gövdesinde yazıldığında React Compiler bunu efektten senkron setState
  // sayıyor (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      fetch("/api/admin/notifications")
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!json) return;
          setItems(json.items ?? []);
          setUnread(json.unread ?? 0);
        })
        .catch(() => {
          /* sessiz */
        }),
    [],
  );

  useEffect(() => runWhenIdle(panel.preload), []);

  // Yeni bildirim `staff:<uid>` konusundan anında gelir (AdminRealtime → window olayı); 60 sn yoklama yalnız yedek:
  // kanal katılı değilken (ilk yükleme, kopukluk, Realtime kapalı) çalışır.
  useEffect(() => {
    load();
    const offEvent = onAdminNotification(() => void load());
    const id = setInterval(() => {
      if (!isAdminRealtimeLive() && document.visibilityState === "visible") void load();
    }, BELL_FALLBACK_POLL_MS);
    return () => {
      offEvent();
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Elle kurulmuş popover: Escape ile kapanma (Radix'teki davranışın dengi).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!Panel) setPanel(() => panel.resolve());
          setOpen((v) => !v);
        }}
        onPointerEnter={panel.preload}
        onFocus={panel.preload}
        className="focus-ring relative grid h-11 w-11 place-items-center rounded-full border border-hairline bg-surface-raised text-text-muted shadow-[var(--elev-1)] transition hover:border-border-interactive hover:text-text"
        aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--nav-badge-danger)] px-1 text-xs font-bold text-white ring-2 ring-[var(--surface)]">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open && Panel ? (
        <Suspense fallback={null}>
          <Panel items={items} unread={unread} tab={tab} setTab={setTab} setItems={setItems} setUnread={setUnread} setOpen={setOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
