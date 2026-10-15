"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, GripHorizontal, Plus } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { updateAppointment } from "@/app/actions/appointments";
import { completeTask, reopenTask } from "@/app/actions/tasks";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { formatTrTime, trDayKey, trParts } from "@/lib/clock";
import { rescheduleToast } from "./reschedule-toast";
import {
  isSameSlot,
  movedStart,
  nudgedStart,
  resizedDuration,
  trDateTimeFields,
  type GridSpec,
} from "./week-drag";

export type WeekViewAppointment = {
  id: string;
  scheduled_at: string;
  duration_min: number | null;
  appointment_type: string;
  status: string;
  customerName: string | null;
  propertyName: string | null;
  location: string | null;
  /** Sürükle-bırak kaydı mevcut notu korur (eylem notu formdan yazar). */
  notes: string | null;
  /** Mobil ajandada sola kaydırma: müşteriye hazır teyit mesajı (wa.me); yoksa null. */
  confirmWaHref?: string | null;
};

/** GA-03: saatli açık görev (ajandada randevularla birlikte). */
export type WeekViewTask = {
  id: string;
  title: string;
  due_at: string;
  customerName: string | null;
};

export type WeekGridDay = { key: string; weekday: string; dayNum: number; isToday: boolean; longLabel: string };

const TYPE_COLOR: Record<string, string> = {
  showing: "bg-brand-600",
  office: "bg-cyan-500",
  valuation: "bg-amber-500",
  contract: "bg-mint-500",
};
const TYPE_LABEL = APPOINTMENT_TYPE_LABELS;

export const GRID: GridSpec = { hourPx: 48, hourStart: 7, hourEnd: 21 };
const GRID_H = (GRID.hourEnd - GRID.hourStart) * GRID.hourPx;
const TASK_BLOCK_MIN = 30;
const LONG_PRESS_MS = 400;
const EDITABLE = new Set(["pending", "confirmed", "signature"]);

/** 07:00 öncesi/21:00 sonrası taşan bloklar ızgara sınırına kırpılır. */
function blockPos(startIso: string, durationMin: number | null) {
  const tp = trParts(startIso);
  const startMin = tp.hour * 60 + tp.minute;
  const endMin = startMin + (durationMin ?? 60);
  const lo = GRID.hourStart * 60;
  const hi = GRID.hourEnd * 60;
  const clampedStart = Math.max(lo, Math.min(startMin, hi - 15));
  const clampedEnd = Math.max(clampedStart + 15, Math.min(endMin, hi));
  return {
    top: ((clampedStart - lo) / 60) * GRID.hourPx,
    height: Math.max(20, ((clampedEnd - clampedStart) / 60) * GRID.hourPx),
  };
}

type Slot = { start: string; duration: number | null };
type DragKind = "move" | "resize";
type Gesture = {
  id: string;
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  touch: boolean;
  active: boolean;
  colWidth: number;
  timer: number | null;
  el: HTMLElement;
};
type DragState = { id: string; kind: DragKind; dy: number; dxDays: number; colWidth: number };

function vibrate() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
  } catch {
    /* desteklenmiyor */
  }
}

/**
 * Hafta/gün saat ızgarası (istemci adası). GA-02: randevu bloğu sürüklenerek saat/gün değiştirir, alt kenardan süre
 * değişir (15 dk yaslama); dokunmatikte 400 ms basılı tutunca başlar (kaydırma bozulmaz), fare 4 px hareketle başlar.
 * Klavye: odaklı blokta Alt+↑/↓ 15 dk kaydırır. Kayıt `updateAppointment` (iyimser konum); çakışmada "Yine de taşı"
 * onayı. Blok tıklaması randevunun kendisini açar (`?randevu=<id>`). GA-03: saatli açık görevler sarı ince blok
 * (tamamla düğmesiyle). Mobilde (<640 px) bu ızgara yerine ajanda listesi çizilir (sunucu).
 */
export function WeekGrid({
  mode,
  days,
  appointments,
  tasks,
  newHref,
  canEdit,
  canEditTasks,
}: {
  mode: "hafta" | "gun";
  days: WeekGridDay[];
  appointments: WeekViewAppointment[];
  tasks: WeekViewTask[];
  newHref: string | null;
  canEdit: boolean;
  canEditTasks: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, Slot>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [conflict, setConflict] = useState<{ appt: WeekViewAppointment; next: Slot; message: string } | null>(null);
  const [doneTasks, setDoneTasks] = useState<ReadonlySet<string>>(() => new Set());
  const colsRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  // Dokunmatik sürüklemede sayfa kaymasın (yalnız sürükleme sürerken; pasif olmayan dinleyici).
  useEffect(() => {
    if (!drag) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("touchmove", prevent, { passive: false });
    return () => window.removeEventListener("touchmove", prevent);
  }, [drag]);

  const hours = Array.from({ length: GRID.hourEnd - GRID.hourStart }, (_, i) => GRID.hourStart + i);
  const slotOf = (a: WeekViewAppointment): Slot => overrides[a.id] ?? { start: a.scheduled_at, duration: a.duration_min };
  const editable = (a: WeekViewAppointment) => canEdit && EDITABLE.has(a.status);

  function save(appt: WeekViewAppointment, next: Slot, confirmConflict: boolean) {
    const prev = overrides[appt.id];
    setOverrides((o) => ({ ...o, [appt.id]: next }));
    const { date, time } = trDateTimeFields(next.start);
    const fd = new FormData();
    fd.set("id", appt.id);
    fd.set("appointment_type", appt.appointment_type);
    fd.set("date", date);
    fd.set("time", time);
    fd.set("duration_min", next.duration != null ? String(next.duration) : "");
    fd.set("location", appt.location ?? "");
    fd.set("notes", appt.notes ?? "");
    if (confirmConflict) fd.set("confirm_conflict", "1");
    const revert = () =>
      setOverrides((o) => {
        const copy = { ...o };
        if (prev) copy[appt.id] = prev;
        else delete copy[appt.id];
        return copy;
      });
    startTransition(async () => {
      try {
        const res = await updateAppointment(fd);
        if (res.conflictWarning) {
          revert();
          setConflict({ appt, next, message: res.conflictWarning });
          return;
        }
        if (res.error) {
          revert();
          push(res.error, "err");
          return;
        }
        const t = rescheduleToast(res.rescheduled);
        push(t.message, "ok", t.action);
        router.refresh();
      } catch {
        revert();
        push("Randevu taşınamadı. Lütfen tekrar deneyin.", "err");
      }
    });
  }

  function commit(state: DragState) {
    const appt = appointments.find((a) => a.id === state.id);
    if (!appt) return;
    const base = slotOf(appt);
    const next: Slot =
      state.kind === "move"
        ? { start: movedStart(base.start, state.dy, state.dxDays, GRID, base.duration), duration: base.duration }
        : { start: base.start, duration: resizedDuration(base.duration, state.dy, GRID) };
    if (isSameSlot(base, next)) return;
    save(appt, next, false);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, appt: WeekViewAppointment, kind: DragKind) {
    if (!editable(appt) || e.button !== 0) return;
    if (kind === "resize") e.stopPropagation();
    const rect = colsRef.current?.getBoundingClientRect();
    const g: Gesture = {
      id: appt.id,
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      touch: e.pointerType !== "mouse",
      active: false,
      colWidth: rect && days.length ? rect.width / days.length : 0,
      timer: null,
      el: e.currentTarget,
    };
    if (g.touch) {
      g.timer = window.setTimeout(() => {
        g.active = true;
        try {
          g.el.setPointerCapture(g.pointerId);
        } catch {
          /* işaretçi bırakılmış */
        }
        vibrate();
        setDrag({ id: g.id, kind: g.kind, dy: 0, dxDays: 0, colWidth: g.colWidth });
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.active) {
      if (g.touch) {
        // Basılı tutmadan kaydırdı: sürükleme değil, sayfa kaydırması.
        if (Math.hypot(dx, dy) > 8) {
          if (g.timer) window.clearTimeout(g.timer);
          gesture.current = null;
        }
        return;
      }
      if (Math.hypot(dx, dy) < 4) return;
      g.active = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* yok say */
      }
    }
    e.preventDefault();
    const dxDays = mode === "hafta" && g.kind === "move" && g.colWidth > 0 ? Math.round(dx / g.colWidth) : 0;
    setDrag({ id: g.id, kind: g.kind, dy, dxDays, colWidth: g.colWidth });
  }

  function endGesture(cancelled: boolean) {
    const g = gesture.current;
    gesture.current = null;
    if (g?.timer) window.clearTimeout(g.timer);
    const state = drag;
    setDrag(null);
    if (!g?.active || !state) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    if (!cancelled) commit(state);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>, appt: WeekViewAppointment) {
    if (!editable(appt) || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const base = slotOf(appt);
    const next = { start: nudgedStart(base.start, e.key === "ArrowUp" ? -1 : 1, GRID, base.duration), duration: base.duration };
    if (!isSameSlot(base, next)) save(appt, next, false);
  }

  function finishTask(task: WeekViewTask) {
    setDoneTasks((s) => new Set(s).add(task.id));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", task.id);
      await completeTask(fd);
      push("Görev tamamlandı.", "ok", {
        action: {
          label: "Geri al",
          onClick: () =>
            startTransition(async () => {
              const r = new FormData();
              r.set("id", task.id);
              await reopenTask(r);
              setDoneTasks((s) => {
                const n = new Set(s);
                n.delete(task.id);
                return n;
              });
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  return (
    <>
      {/* Gün başlıkları */}
      <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="sticky left-0 z-10 bg-surface" />
        {days.map((d) => (
          <div key={d.key} className="border-b border-line px-2 pb-2 text-center">
            <p className={`text-xs font-bold uppercase ${d.isToday ? "text-brand-600" : "text-text-faint"}`}>{d.weekday}</p>
            <p className={`font-display text-lg font-extrabold ${d.isToday ? "text-brand-600" : "text-ink-950"}`}>{d.dayNum}</p>
          </div>
        ))}
      </div>

      {/* Saat ızgarası + bloklar */}
      <div className="grid" style={{ gridTemplateColumns: "48px minmax(0, 1fr)" }}>
        <div className="sticky left-0 z-10 bg-surface" style={{ height: GRID_H }}>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-text-faint"
              style={{ top: (h - GRID.hourStart) * GRID.hourPx }}
            >
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        <div ref={colsRef} className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => {
            const dayAppts = appointments
              .filter((a) => trDayKey(slotOf(a).start) === d.key)
              .sort((a, b) => slotOf(a).start.localeCompare(slotOf(b).start));
            const dayTasks = tasks.filter((t) => trDayKey(t.due_at) === d.key && !doneTasks.has(t.id));
            return (
              <div key={d.key} className="relative border-l border-line" style={{ height: GRID_H }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-line/60"
                    style={{ top: (h - GRID.hourStart) * GRID.hourPx }}
                    aria-hidden
                  />
                ))}
                {/* Boş saat → yeni randevu (yalnız fare/kalem; dokunmatikte kaydırırken yanlış açılmasın, B144). */}
                {newHref
                  ? hours.map((h) => {
                      const hh = String(h).padStart(2, "0");
                      const sep = newHref.includes("?") ? "&" : "?";
                      return (
                        <Link
                          key={h}
                          href={`${newHref}${sep}tarih=${d.key}&saat=${hh}:00`}
                          aria-label={`${d.longLabel} saat ${hh}:00 için randevu ekle`}
                          title={`${hh}:00 için randevu ekle`}
                          className="focus-ring group absolute inset-x-0 z-0 flex items-center justify-center text-brand-600 opacity-0 transition hover:bg-brand-600/[0.06] hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden"
                          style={{ top: (h - GRID.hourStart) * GRID.hourPx, height: GRID.hourPx }}
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </Link>
                      );
                    })
                  : null}

                {dayAppts.map((a) => {
                  const slot = slotOf(a);
                  const dragging = drag?.id === a.id ? drag : null;
                  const preview: Slot = dragging
                    ? dragging.kind === "move"
                      ? { start: movedStart(slot.start, dragging.dy, dragging.dxDays, GRID, slot.duration), duration: slot.duration }
                      : { start: slot.start, duration: resizedDuration(slot.duration, dragging.dy, GRID) }
                    : slot;
                  // Sürüklenirken blok kendi sütununda kalır, yatayda hedef güne kaydırılarak gösterilir.
                  const dayShift = dragging?.kind === "move" ? dragging.dxDays : 0;
                  const { top, height } = blockPos(preview.start, preview.duration);
                  const startLabel = formatTrTime(preview.start);
                  const color = TYPE_COLOR[a.appointment_type] ?? "bg-brand-600";
                  const canDrag = editable(a);
                  const typeText = TYPE_LABEL[a.appointment_type] ?? a.appointment_type;
                  return (
                    <Link
                      key={a.id}
                      href={`/app/randevular?randevu=${a.id}`}
                      prefetch={false}
                      draggable={false}
                      onClick={(e) => {
                        if (suppressClick.current) e.preventDefault();
                      }}
                      onPointerDown={(e) => onPointerDown(e, a, "move")}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => endGesture(false)}
                      onPointerCancel={() => endGesture(true)}
                      onContextMenu={(e) => {
                        if (canDrag) e.preventDefault();
                      }}
                      onKeyDown={(e) => onKeyDown(e, a)}
                      aria-roledescription={canDrag ? "taşınabilir randevu" : undefined}
                      aria-keyshortcuts={canDrag ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                      title={`${startLabel} · ${typeText}${a.customerName ? ` · ${a.customerName}` : ""}${canDrag ? " — sürükleyerek taşıyın (Alt+↑/↓: 15 dk)" : ""}`}
                      className={`focus-ring absolute inset-x-1 z-[1] select-none overflow-hidden rounded-[var(--radius-control)] ${color} px-1.5 py-1 text-white [-webkit-touch-callout:none] ${
                        dragging ? "z-20 shadow-[var(--shadow-lg)] ring-2 ring-white/70" : "transition hover:brightness-110"
                      } ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${a.status === "cancelled" ? "opacity-50" : ""}`}
                      style={{
                        top,
                        height,
                        touchAction: dragging ? "none" : "pan-y",
                        transform: dayShift && dragging ? `translateX(${dayShift * dragging.colWidth}px)` : undefined,
                      }}
                    >
                      <p className="truncate text-xs font-bold leading-tight">
                        {startLabel}
                        {dragging?.kind === "resize" ? ` · ${preview.duration} dk` : mode === "gun" ? ` · ${typeText}` : ""}
                      </p>
                      {height >= 32 ? (
                        <p className="truncate text-xs leading-tight opacity-90">{a.customerName ?? typeText}</p>
                      ) : null}
                      {mode === "gun" && height >= 48 ? (
                        <p className="truncate text-xs leading-tight opacity-75">{a.propertyName ?? a.location ?? ""}</p>
                      ) : null}
                      {canDrag ? (
                        <span
                          aria-hidden
                          onPointerDown={(e) => onPointerDown(e, a, "resize")}
                          className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-center justify-center opacity-70 [@media(hover:none)]:h-4"
                        >
                          <GripHorizontal className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                    </Link>
                  );
                })}

                {dayTasks.map((t) => {
                  const { top } = blockPos(t.due_at, TASK_BLOCK_MIN);
                  return (
                    <div
                      key={t.id}
                      className="absolute left-1/3 right-1 z-[2] flex items-center gap-1 overflow-hidden rounded-[var(--radius-control)] border border-amber-500/50 bg-amber-400/25 px-1 text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur-sm"
                      style={{ top, height: 22 }}
                    >
                      {canEditTasks ? (
                        <button
                          type="button"
                          onClick={() => finishTask(t)}
                          aria-label={`Görevi tamamla: ${t.title}`}
                          className="focus-ring grid h-4 w-4 shrink-0 place-items-center rounded border border-amber-600/60 bg-surface text-amber-700 hover:bg-canvas"
                        >
                          <Check className="h-3 w-3 opacity-40" aria-hidden />
                        </button>
                      ) : null}
                      <Link
                        href={`/app/gorevler?gorev=${t.id}`}
                        prefetch={false}
                        title={`${formatTrTime(t.due_at)} · Görev: ${t.title}${t.customerName ? ` · ${t.customerName}` : ""}`}
                        className="focus-ring min-w-0 flex-1 truncate text-[11px] font-semibold leading-none"
                      >
                        {t.title}
                      </Link>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={conflict != null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
        title="Bu saatte başka randevu var"
        description={conflict ? `${conflict.message.replace(/ Kaydetmek için tekrar gönderin\.$/, "")} Yine de taşımak istiyor musunuz?` : undefined}
        confirmLabel="Yine de taşı"
        tone="default"
        onConfirm={() => {
          const c = conflict;
          setConflict(null);
          if (c) save(c.appt, c.next, true);
        }}
      />
    </>
  );
}
