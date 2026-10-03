"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { NotificationRow } from "@/app/actions/notifications";
import { runWhenIdle } from "@/lib/idle";
import { onNotificationInsert } from "@/lib/realtime";

/**
 * Zil — hafif kabuk. Okunmamış sayacı, canlı bildirim olayı ve uygulama rozeti burada kalır;
 * panel (Radix Popover, sekmeler, tercihler, okundu eylemleri) ilk tıklamada yüklenir
 * (hover/odak önceden ısıtır). Yüklenince gerçek bileşen aynı düğmeyi devralır ve açık gelir.
 */
const loadPanel = () => import("./notification-bell-panel").then((m) => ({ default: m.NotificationBellPanel }));
const Panel = lazy(loadPanel);

function Trigger({ unread, shake, onShakeEnd, onOpen, onWarm }: { unread: number; shake?: boolean; onShakeEnd?: () => void; onOpen?: () => void; onWarm?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      aria-haspopup="dialog"
      aria-expanded={false}
      className="focus-ring relative grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
      aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
    >
      <Bell className={`h-4 w-4${shake ? " es-bell-shake" : ""}`} onAnimationEnd={onShakeEnd} />
      {unread > 0 ? (
        <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-white bg-danger-500 px-1 text-xs font-bold leading-none text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  );
}

export function NotificationBell({ initial }: { initial: NotificationRow[] }) {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState(initial);
  const [shake, setShake] = useState(false);

  // Sayfa boşalınca panel parçasını arka planda indir: ilk tıklama beklemesin (hover/odak ısıtması ek güvence).
  useEffect(() => runWhenIdle(() => void loadPanel()), []);

  // Canlı bildirim: RealtimeRefresh, notifications INSERT'lerini window event olarak
  // köprüler (bkz. src/lib/realtime.ts). Listeye anında ekle + zili bir kez salla.
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

  // Sunucudan yeni `initial` geldiğinde yerel listeyi tazele ("prop değişiminde render
  // sırasında state ayarla" deseni).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setItems(initial);
  }

  const unread = items.filter((n) => !n.read_at).length;

  // App Badge API (panel yüklenince rozeti o yönetir; burada yalnız yüklenmeden önce).
  useEffect(() => {
    if (mounted) return;
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
  }, [unread, mounted]);

  if (!mounted) {
    return (
      <>
        <style>{BELL_STYLE}</style>
        <Trigger unread={unread} shake={shake} onShakeEnd={() => setShake(false)} onOpen={() => setMounted(true)} onWarm={() => void loadPanel()} />
      </>
    );
  }
  return (
    <Suspense fallback={<Trigger unread={unread} />}>
      <Panel items={items} setItems={setItems} shake={shake} setShake={setShake} />
    </Suspense>
  );
}

const BELL_STYLE = `
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
`;
