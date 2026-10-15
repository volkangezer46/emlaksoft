"use client";

import { Suspense, startTransition, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { getMyUnreadNotificationCount, type NotificationFeed, type NotificationRow } from "@/app/actions/notifications";
import { useToast } from "@/components/app/toast-provider";
import { daysFromNowIso, msSince, now as clockNow } from "@/lib/clock";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import {
  addBellItem,
  applyReadsToBell,
  notificationBadgeLabel,
  notificationHref,
  notificationNeedsAttention,
  parseReadsPayload,
  type BellState as BellStateOf,
} from "@/lib/notification-text";
import { ensureRealtimeAuth, onNotificationInsert } from "@/lib/realtime";

/**
 * Zil — hafif kabuk. Zil DÜĞMESİ, açık/kapalı durumu, okunmamış SAYACI (sunucunun gerçek sayımı:
 * `my_notification_counts`, listeden sayılmaz), canlı bildirim olayı, ikinci cihazdaki okuma eşlemesi ('reads:<uid>'
 * yayını) ve uygulama rozeti burada kalır. Panel İÇERİĞİ (Radix Popover, sekmeler, okundu eylemleri) ilk dokunuşta
 * bağlanır: basışta (pointerdown) AYNI KAREDE hafif bir örtü çizilir, ağır içerik geçiş (transition) içinde arkadan
 * bağlanır ve hazır olunca örtünün yerini alır (`lazyPanel`; parça boşta önceden iner). Düğme hiç değişmez (DOM
 * takası yok): basışın ardından gelen tık aynı düğmeye düşer ve paneli geri kapatmaz, klavye odağı kaybolmaz.
 * Rozet 99'a kadar sayar, artışta kısa bir nabız oynar; karar bekleyen bildirim ayrıca toast olur.
 */
const panel = lazyPanel(() => import("./notification-bell-panel").then((m) => m.NotificationBellPanel));

/** Zil durumu tek nesnede: liste ile sayaç aynı güncellemede değişir (çift sayım / yarış yok). */
export type BellState = BellStateOf<NotificationRow>;
export type BellStateSetter = Dispatch<SetStateAction<BellState>>;

const MAX_ITEMS = 50;
/** Kanal (yeniden) katıldığında sayaç bu süreden eskiyse sunucudan bir kez eşlenir (açılış penceresi / kopma dönüşü). */
const RESYNC_AFTER_MS = 1000;
/** Basıştan sonra bu süre içinde gelen tık, basışın açtığı paneli kapatmaz (aynı dokunuşun tıkı). */
const PRESS_CLICK_WINDOW_MS = 1500;

function fromInitial(initial: NotificationRow[] | NotificationFeed): BellState {
  if (Array.isArray(initial)) return { items: initial, unread: initial.filter((n) => !n.read_at).length, pulse: 0 };
  return { items: initial.items, unread: Math.max(0, initial.unreadTotal), pulse: 0 };
}

/** Sayaç sunucudan eşlenirken artış varsa rozet nabzı da oynar. */
function withUnread(s: BellState, unread: number): BellState {
  if (s.unread === unread) return s;
  return { ...s, unread, pulse: unread > s.unread ? s.pulse + 1 : s.pulse };
}

/** Zil düğmesi: masaüstünde 40 px (kabukla aynı), dokunmatik ekranda her genişlikte 44 px (`touch:size-11`). */
export const BELL_BUTTON_CLASS =
  "focus-ring relative grid h-11 w-11 place-items-center sm:h-10 sm:w-10 touch:size-11 rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600";

/** Rozet: 99'a kadar sayı; artışta (`pulse` anahtarı değişince) kısa nabız. */
export function BellBadge({ unread, pulse }: { unread: number; pulse: number }) {
  if (unread <= 0) return null;
  return (
    <span
      key={pulse}
      aria-hidden="true"
      className={`absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-white bg-danger-500 px-1 text-xs font-bold leading-none text-white${pulse > 0 ? " es-badge-pulse" : ""}`}
    >
      {notificationBadgeLabel(unread)}
    </span>
  );
}

/** Basışta aynı karede çizilen hafif örtü: panelin iskeleti + ilk satır başlıkları (Radix/ikon/animasyon yok). */
function BellOverlay({ state }: { state: BellState }) {
  const rows = state.items.slice(0, 6);
  return (
    <div
      aria-hidden="true"
      className="absolute right-0 top-full z-[60] mt-2 max-h-[calc(100dvh-5rem)] w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-lg)]"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="font-display text-sm font-bold text-ink-950">Bildirimler</p>
        {state.unread > 0 ? (
          <span className="rounded-full bg-danger-500/10 px-1.5 py-0.5 text-xs font-bold text-danger-600">{state.unread} yeni</span>
        ) : null}
      </div>
      <div className="h-9 border-b border-line" />
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-text-muted">Yükleniyor…</div>
      ) : (
        rows.map((n) => (
          <div key={n.id} className={`border-b border-line px-4 py-3 last:border-0 ${n.read_at ? "opacity-60" : ""}`}>
            <p className="truncate text-sm font-semibold text-ink-950">{n.title}</p>
            <span className="mt-1.5 block h-2 w-24 rounded-full bg-canvas" />
          </div>
        ))
      )}
    </div>
  );
}

export function NotificationBell({ initial }: { initial: NotificationRow[] | NotificationFeed }) {
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  const mounted = Panel !== null;
  const [state, setState] = useState<BellState>(() => fromInitial(initial));
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shake, setShake] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Son basışın olay zaman damgası (event.timeStamp): ardından gelen tık aynı dokunuşa aittir. */
  const pressStamp = useRef<number | null>(null);
  const lastSyncAt = useRef(0);
  const pathRef = useRef<string | null>(null);
  const { push } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Sayfa boşalınca panel parçasını arka planda indir: ilk dokunuş beklemesin (hover/odak ısıtması ek güvence).
  useEffect(() => runWhenIdle(panel.preload), []);

  // Sunucudan yeni `initial` geldiğinde yerel durumu sunucu gerçeğine eşle ("prop değişiminde render sırasında
  // state ayarla" deseni; layout her tazelenişte güncel sayaç + liste gönderir).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setState((s) => {
      const next = fromInitial(initial);
      return { ...next, pulse: next.unread > s.unread ? s.pulse + 1 : s.pulse };
    });
  }

  const resync = useCallback(async () => {
    lastSyncAt.current = clockNow();
    const r = await getMyUnreadNotificationCount();
    if ("unread" in r) startTransition(() => setState((s) => withUnread(s, r.unread)));
  }, []);

  // Canlı bildirim: RealtimeRefresh, bildirim olaylarını window event olarak köprüler (src/lib/realtime.ts).
  // Listeye anında ekle, sayacı +1 (rozet nabzı), zili bir kez salla; karar bekleyen olayda ayrıca toast.
  useEffect(() => {
    return onNotificationInsert((row) => {
      let added = false;
      setState((s) => {
        const next = addBellItem(
          s,
          { id: row.id, title: row.title, body: row.body, href: row.href, kind: row.kind, read_at: row.read_at, created_at: row.created_at },
          MAX_ITEMS,
        );
        added = next !== s;
        return next;
      });
      if (!added) return;
      setShake(true);
      if (!row.read_at && notificationNeedsAttention(row)) {
        const href = notificationHref(row);
        push(row.title, "info", href ? { action: { label: "Aç", onClick: () => router.push(href) } } : undefined);
      }
    });
  }, [push, router]);

  // İkinci cihaz/sekmedeki okuma ('reads:<uid>' özel Broadcast konusu; migration 20261016050000). Abonelik boşta,
  // supabase-js ayrı parçadan, kanal oturum jetonuyla katılır (`ensureRealtimeAuth`). Kanal katıldığında (ilk açılış
  // ya da kopma/uyku dönüşü) sayaç 1 sn'den eskiyse sunucudan bir kez eşlenir; böylece kanal kapalıyken yapılan
  // okumalar da kaçmaz.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    lastSyncAt.current = clockNow();
    const cancelIdle = runWhenIdle(
      () =>
        void import("@/lib/supabase/client").then(async ({ createClient }) => {
          if (cancelled) return;
          const client = createClient();
          const { data } = await client.auth.getSession();
          const uid = data.session?.user?.id;
          if (!uid || cancelled) return;
          await ensureRealtimeAuth(client);
          if (cancelled) return;
          const channel = client
            .channel(`reads:${uid}`, { config: { private: true } })
            .on("broadcast", { event: "read" }, (msg: { payload?: unknown }) => {
              const p = parseReadsPayload(msg.payload);
              if (!p) return;
              setState((s) => applyReadsToBell(s, p.ids, daysFromNowIso(0)));
              // Yük 50 kimlikle sınırlı: daha çok okunduysa sayaç sunucudan eşlenir.
              if (p.n > p.ids.length) void resync();
              // Bildirim sayfası açıksa satırlar da okunmuş görünsün.
              if (pathRef.current?.startsWith("/app/bildirimler")) router.refresh();
            })
            .subscribe((status: string) => {
              if (status === "SUBSCRIBED" && msSince(lastSyncAt.current) > RESYNC_AFTER_MS) void resync();
            });
          cleanup = () => {
            void client.removeChannel(channel);
          };
        }),
      800,
    );
    return () => {
      cancelled = true;
      cancelIdle();
      cleanup?.();
    };
  }, [resync, router]);

  // App Badge API (PWA ana ekran ikonu). Desteklemeyen tarayıcıda sessizce atlanır.
  const unread = state.unread;
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

  const onPanelReady = useCallback(() => setOpening(false), []);

  /** İlk açılış: örtü bu karede çizilir, ağır panel geçiş içinde bağlanır ve hazır olunca yerini alır. */
  function openFirstTime() {
    setOpen(true);
    setOpening(true);
    startTransition(() => setPanel(() => panel.resolve()));
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || mounted || opening) return;
    pressStamp.current = e.timeStamp;
    openFirstTime();
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    const pressedAt = pressStamp.current;
    pressStamp.current = null;
    // Basışla açılan panelin tıkı: aynı dokunuşun parçası, paneli geri kapatmaz.
    if (pressedAt !== null && e.timeStamp - pressedAt < PRESS_CLICK_WINDOW_MS) return;
    if (!mounted) {
      // Klavye (Enter/Boşluk) yolu: basış olmadı; aynı akış.
      if (!opening) openFirstTime();
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <span className="relative inline-flex">
      <style>{BELL_STYLE}</style>
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerCancel={() => {
          pressStamp.current = null;
        }}
        onClick={onClick}
        onPointerEnter={panel.preload}
        onFocus={panel.preload}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={BELL_BUTTON_CLASS}
        aria-label={`Bildirimler${unread > 0 ? ` (${unread} okunmamış)` : ""}`}
      >
        <Bell className={`h-4 w-4${shake ? " es-bell-shake" : ""}`} onAnimationEnd={() => setShake(false)} />
        <BellBadge unread={unread} pulse={state.pulse} />
      </button>
      {Panel ? (
        <Suspense fallback={null}>
          <Panel
            state={state}
            setState={setState}
            open={open}
            onOpenChange={setOpen}
            anchorRef={buttonRef}
            onReady={onPanelReady}
          />
        </Suspense>
      ) : null}
      {opening ? <BellOverlay state={state} /> : null}
    </span>
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
  @keyframes es-badge-pulse {
    0% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger-500) 55%, transparent); }
    40% { transform: scale(1.25); }
    100% { transform: scale(1); box-shadow: 0 0 0 8px transparent; }
  }
  .es-badge-pulse { animation: es-badge-pulse 0.6s ease-out 1; }
  @media (prefers-reduced-motion: reduce) {
    .es-bell-shake, .es-badge-pulse { animation: none; }
  }
`;
