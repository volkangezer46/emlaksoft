"use client";

import { useEffect, useMemo, useState, startTransition, type RefObject } from "react";
import { Anchor as PopoverAnchor } from "@radix-ui/react-popover";
import Link from "@/components/ui/smart-link";
import {
  AlertOctagon,
  AlertTriangle,
  BellOff,
  CheckCheck,
  CheckCircle2,
  Info,
  Loader2,
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
import { useToast } from "@/components/app/toast-provider";
import { runOptimistic } from "@/lib/optimistic";
import { daysFromNowIso, msSince, now as clockNow, trDayStartMs } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { AutoAnimate } from "@/components/ui/auto-animate";
import {
  markBellAllRead,
  markBellItemRead,
  notificationHref,
  revertBellAllRead,
  stripNotificationMarker,
  unmarkBellItemRead,
} from "@/lib/notification-text";
import type { BellState, BellStateSetter } from "./notification-bell";

const KIND_META: Record<string, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: "bg-mint-500/12 text-mint-600" },
  warning: { icon: AlertTriangle, cls: "bg-amber-400/15 text-amber-600" },
  danger: { icon: AlertOctagon, cls: "bg-danger-500/10 text-danger-500" },
  system: { icon: Settings, cls: "bg-cyan-400/12 text-cyan-600" },
  info: { icon: Info, cls: "bg-brand-600/10 text-brand-600" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? KIND_META.info;
}

/** Bildirimleri zaman dilimine göre grupla: Bugün / Bu hafta / Daha eski. */
function groupByTime(items: NotificationRow[]) {
  const now = clockNow();
  const dayStart = trDayStartMs(now);
  const weekMs = 7 * 86_400_000;

  const groups: { label: string; items: NotificationRow[] }[] = [
    { label: "Bugün", items: [] },
    { label: "Bu hafta", items: [] },
    { label: "Daha eski", items: [] },
  ];
  for (const n of items) {
    const t = new Date(n.created_at).getTime();
    if (t >= dayStart) groups[0].items.push(n);
    else if (now - t < weekMs) groups[1].items.push(n);
    else groups[2].items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

const REL_DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };

function relTime(iso: string) {
  const mins = Math.floor(msSince(iso) / 60_000);
  if (mins < 1) return "şimdi";
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return formatDateTimeTr(iso, REL_DATE);
}

/**
 * Zil paneli İÇERİĞİ. Düğme ve açık/kapalı durumu kabukta (`notification-bell.tsx`); burası Radix Popover'ı kabuğun
 * düğmesine bağlar (`PopoverAnchor virtualRef`), düğmeye basış dış tıklama sayılmaz (kabuk aç/kapa yapar).
 * Yükseklik Radix'in verdiği kullanılabilir yükseklikle sınırlı: başlık + sekmeler + alt bağlantılar sabit, yalnız
 * liste içten kayar (yatay telefonda da "Tümünü gör" erişilebilir).
 * Okundu eylemleri iyimserdir: sayaç anında düşer, sunucu reddederse geri alınır ve toast çıkar.
 */
export function NotificationBellPanel({
  state,
  setState,
  open,
  onOpenChange,
  anchorRef,
  onReady,
}: {
  state: BellState;
  setState: BellStateSetter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onReady: () => void;
}) {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(() => readNotifPrefs());
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);

  // Bağlandı: kabuktaki hafif örtü kalkar (içerik bu commit'te DOM'da).
  useEffect(() => {
    onReady();
  }, [onReady]);

  // Her açılışta listeyi ve sayacı sunucudan tazele; tercihler de o an okunur (localStorage).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listMyNotifications().then((next) => {
      if (!alive) return;
      startTransition(() => {
        setPrefs(readNotifPrefs());
        setState((s) => ({ items: next.items, unread: next.unreadTotal, pulse: next.unreadTotal > s.unread ? s.pulse + 1 : s.pulse }));
      });
    });
    return () => {
      alive = false;
    };
  }, [open, setState]);

  const items = state.items;
  const visible = useMemo(() => {
    if (!prefs) return items;
    return items.filter((n) => filterByNotifPrefs(n.title, n.body, prefs));
  }, [items, prefs]);

  // Sayaç sunucunun gerçek sayımıdır (zil rozetiyle aynı); sekme listesi yüklü satırlardan süzülür.
  const unread = state.unread;
  const shown = tab === "unread" ? visible.filter((n) => !n.read_at) : visible;
  const groups = groupByTime(shown);

  async function onRead(id: string) {
    // Okunmuşa tekrar tıklanınca sunucuya boş yere yazılmasın.
    if (items.find((n) => n.id === id)?.read_at) return;
    const markedAt = daysFromNowIso(0);
    await runOptimistic({
      apply: () => setState((s) => markBellItemRead(s, id, markedAt)),
      commit: () => markNotificationRead(id),
      rollback: () => setState((s) => unmarkBellItemRead(s, id, markedAt)),
      onError: (m) => push(m, "err"),
      fallbackError: "Bildirim okundu işaretlenemedi",
    });
  }

  async function onReadAll() {
    if (markingAll) return;
    setMarkingAll(true);
    const before = state;
    const markedAt = daysFromNowIso(0);
    // Liste ve rozet anında okunmuş görünür (spinner yalnız çifte tıklamayı engeller).
    await runOptimistic({
      apply: () => setState((s) => markBellAllRead(s, markedAt)),
      commit: () => markAllNotificationsRead(),
      rollback: () => setState((s) => revertBellAllRead(s, before, markedAt)),
      onError: (m) => push(m, "err"),
      fallbackError: "Bildirimler okundu işaretlenemedi",
    });
    setMarkingAll(false);
  }

  function renderItem(n: NotificationRow) {
    const meta = kindMeta(n.kind);
    const Icon = meta.icon;
    const inner = (
      <div className={`flex gap-3 px-4 py-3 transition hover:bg-canvas ${n.read_at ? "opacity-60" : ""}`}>
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
            {!n.read_at ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" /> : null}
            <span className="truncate">{n.title}</span>
          </p>
          {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{stripNotificationMarker(n.body)}</p> : null}
          <p className="mt-1 text-xs text-text-faint">{relTime(n.created_at)}</p>
        </div>
      </div>
    );
    const href = notificationHref(n);
    return href ? (
      <Link
        key={n.id}
        href={href}
        onClick={() => {
          void onRead(n.id);
          onOpenChange(false);
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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        aria-label="Bildirimler"
        className="flex w-[min(380px,calc(100vw-1.5rem))] flex-col p-0"
        style={{ maxHeight: "min(36rem, var(--radix-popover-content-available-height, 36rem))" }}
        align="end"
        collisionPadding={8}
        // Zil düğmesine basış "dış tıklama" sayılmaz: aç/kapa kabuktaki düğmenin işidir (yoksa kapanıp yeniden açılırdı).
        onInteractOutside={(e) => {
          const target = e.target as Node | null;
          if (target && anchorRef.current?.contains(target)) e.preventDefault();
        }}
        // Kapanınca odak zil düğmesine döner (Radix tetikleyicisi yok; düğme kabukta).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          anchorRef.current?.focus();
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="font-display text-sm font-bold text-ink-950">Bildirimler</p>
            {unread > 0 ? (
              <span className="rounded-full bg-danger-500/10 px-1.5 py-0.5 text-xs font-bold text-danger-600">{unread} yeni</span>
            ) : null}
          </div>
          {unread > 0 ? (
            <button
              type="button"
              disabled={markingAll}
              onClick={onReadAll}
              className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-60 touch:min-h-11"
            >
              {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              {markingAll ? "İşleniyor…" : "Tümünü oku"}
            </button>
          ) : null}
        </div>

        {/* Sekmeler */}
        <div role="tablist" aria-label="Bildirim görünümü" className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5">
          {([
            { key: "all", label: "Tümü" },
            { key: "unread", label: `Okunmamış${unread > 0 ? ` (${unread})` : ""}` },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`notification-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="notification-tabpanel"
              onClick={() => setTab(t.key)}
              className={`rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition touch:min-h-11 ${tab === t.key ? "bg-brand-600/10 text-brand-600" : "text-text-muted hover:bg-canvas"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          id="notification-tabpanel"
          role="tabpanel"
          aria-labelledby={`notification-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {shown.length === 0 ? (
            <div className="grid place-items-center px-4 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-canvas text-text-faint">
                <BellOff className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink-950">
                {tab === "unread" && unread > 0 ? "Son bildirimlerin hepsi okundu" : tab === "unread" ? "Okunmamış bildirim yok" : "Bildirim yok"}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {tab === "unread" && unread > 0 ? (
                  <Link href="/app/bildirimler?durum=okunmamis" onClick={() => onOpenChange(false)} className="font-semibold text-brand-600 hover:underline">
                    Daha eski {unread} okunmamışı gör
                  </Link>
                ) : (
                  "Yeni etkinlikler burada görünecek."
                )}
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <AutoAnimate key={g.label}>
                <p className="sticky top-0 z-10 bg-canvas px-4 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">{g.label}</p>
                {g.items.map(renderItem)}
              </AutoAnimate>
            ))
          )}
        </div>

        {/* Arşiv: tüm bildirimlerin filtreli/sayfalı tam listesi */}
        <div className="flex shrink-0 divide-x divide-line border-t border-line">
          <Link
            href="/app/bildirimler"
            onClick={() => onOpenChange(false)}
            className="block flex-1 px-4 py-2.5 text-center text-xs font-semibold text-brand-600 transition hover:bg-canvas touch:min-h-11"
          >
            Tümünü gör
          </Link>
          <Link
            href="/app/bildirimler?sekme=duyurular"
            onClick={() => onOpenChange(false)}
            className="block flex-1 px-4 py-2.5 text-center text-xs font-semibold text-brand-600 transition hover:bg-canvas touch:min-h-11"
          >
            Duyurular
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
