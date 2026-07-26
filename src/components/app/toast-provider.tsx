"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type Tone = "ok" | "err" | "info";
type Toast = { id: number; message: string; tone: Tone; leaving?: boolean };

const Ctx = createContext<{ push: (message: string, tone?: Tone) => void } | null>(null);

const DURATION = 4000;
const EXIT_MS = 160;

const TONE_STYLE: Record<Tone, { bar: string; icon: React.ReactNode; text: string }> = {
  ok: {
    bar: "bg-mint-500",
    icon: <CheckCircle2 className="h-4.5 w-4.5 text-mint-600" />,
    text: "text-ink-950",
  },
  err: {
    bar: "bg-danger-500",
    icon: <AlertTriangle className="h-4.5 w-4.5 text-danger-500" />,
    text: "text-ink-950",
  },
  info: {
    bar: "bg-brand-600",
    icon: <Info className="h-4.5 w-4.5 text-brand-600" />,
    text: "text-ink-950",
  },
};

/**
 * Toast — kullanıcının her kayıt işleminde gördüğü mikro-an.
 * Giriş spring easing'li, çıkış kısa fade; hover'da sayaç durur;
 * ikon + ton çizgisi + kapatma; role=status ile ekran okuyucuya duyurulur.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<Map<number, { timeout: number; remaining: number; startedAt: number }>>(
    new Map(),
  );

  const remove = useCallback((id: number) => {
    // Önce çıkış animasyonu, sonra DOM'dan kaldır
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_MS);
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer.timeout);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      const timeout = window.setTimeout(() => remove(id), ms);
      timers.current.set(id, { timeout, remaining: ms, startedAt: Date.now() });
    },
    [remove],
  );

  const push = useCallback(
    (message: string, tone: Tone = "ok") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, message, tone }]);
      schedule(id, DURATION);
    },
    [schedule],
  );

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer.timeout);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (!timer) return;
      schedule(id, Math.max(600, timer.remaining));
    },
    [schedule],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((t) => {
          const s = TONE_STYLE[t.tone];
          return (
            <div
              key={t.id}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              className={`${t.leaving ? "toast-out" : "toast-in"} surface-card pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-[12px] py-3 pl-4 pr-2 shadow-[var(--inner-top),var(--elev-4)]`}
            >
              <span className={`absolute inset-y-0 left-0 w-[3px] ${s.bar}`} />
              <span className="mt-0.5 shrink-0">{s.icon}</span>
              <p className={`flex-1 text-sm font-semibold ${s.text}`}>{t.message}</p>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Kapat"
                className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-ink-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) return { push: (_m: string, _t?: Tone) => undefined };
  return ctx;
}
