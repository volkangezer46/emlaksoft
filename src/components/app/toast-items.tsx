"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { Toast, ToastTone } from "./toast-provider";

const TONE_STYLE: Record<ToastTone, { bar: string; icon: React.ReactNode; text: string; tint: string }> = {
  ok: {
    bar: "bg-mint-500",
    icon: <CheckCircle2 className="h-4.5 w-4.5 text-mint-600" />,
    text: "text-ink-950",
    tint: "text-mint-600",
  },
  err: {
    bar: "bg-danger-500",
    icon: <AlertTriangle className="h-4.5 w-4.5 text-danger-500" />,
    text: "text-ink-950",
    tint: "text-danger-500",
  },
  info: {
    bar: "bg-brand-600",
    icon: <Info className="h-4.5 w-4.5 text-brand-600" />,
    text: "text-ink-950",
    tint: "text-brand-600",
  },
};

export type ToastItemsProps = {
  items: Toast[];
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onRemove: (id: number) => void;
};

/** Bildirim kartları (görünüm): `ToastProvider` durumu ve süreleri tutar; bu parça yalnız çizer. */
export function ToastItems({ items, onPause: pause, onResume: resume, onRemove: remove }: ToastItemsProps) {
  return (
    <>
        {items.map((t) => {
          const s = TONE_STYLE[t.tone];
          return (
            <div
              key={t.id}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              // Odak bildirimin içinde düğmeden düğmeye geçerken süre tek kez durur / tek kez sürer.
              onFocus={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) pause(t.id);
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(t.id);
              }}
              className={`${t.leaving ? "toast-out" : "toast-in"} surface-card pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-[var(--radius-card)] py-3 pl-4 pr-2 shadow-[var(--inner-top),var(--elev-4)]`}
            >
              <span className={`absolute inset-y-0 left-0 w-[3px] ${s.bar}`} />
              <span className={`toast-ico shrink-0 ${s.tint}`} aria-hidden="true">{s.icon}</span>
              <p className={`flex-1 text-sm font-semibold ${s.text}`}>{t.message}</p>
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                  className="focus-ring shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-sm font-bold text-brand-600 transition hover:bg-brand-600/10"
                >
                  {t.action.label}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Kapat"
                className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-950 touch:min-h-11 touch:min-w-11"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
    </>
  );
}
