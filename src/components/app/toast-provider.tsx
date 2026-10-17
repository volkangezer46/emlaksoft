"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { runWhenIdle } from "@/lib/idle";
import type { ToastItemsProps } from "./toast-items";

type Tone = "ok" | "err" | "info";
/**
 * İsteğe bağlı tek eylem (ör. "Geri al"): tıklanınca çalışır ve bildirim kapanır. Eylemli bildirim en az 15 sn kalır
 * (B073: 8 sn'de "Geri al" okunup basılamadan kayboluyordu); fare üstündeyken ya da odak içindeyken süre durur.
 */
export type ToastAction = { label: string; onClick: () => void };
export type ToastTone = Tone;
export type Toast = { id: number; message: string; tone: Tone; action?: ToastAction; leaving?: boolean };
type PushFn = (message: string, tone?: Tone, opts?: { action?: ToastAction }) => void;

const Ctx = createContext<{ push: PushFn } | null>(null);

const DURATION = 4000;
const ACTION_DURATION = 15_000;
const EXIT_MS = 160;

/**
 * Kart görünümü parçası: boşta önceden iner; ilk bildirimde henüz inmediyse hemen istenir. Askıya alma (`React.lazy`)
 * YOK: parça inene dek kartlar çizilmez, inince o anki liste çizilir (süreler sağlayıcıda zaten işler). İndirme hatası
 * kabuğu düşürmez (hata sınırına gitmez); sonraki bildirimde yeniden denenir.
 */
let LoadedItems: ComponentType<ToastItemsProps> | null = null;
let itemsLoading: Promise<ComponentType<ToastItemsProps>> | null = null;
function loadItems(): Promise<ComponentType<ToastItemsProps>> {
  itemsLoading ??= import("./toast-items").then(
    (m) => (LoadedItems = m.ToastItems),
    (error: unknown) => {
      itemsLoading = null;
      throw error;
    },
  );
  return itemsLoading;
}

/**
 * Toast — kullanıcının her kayıt işleminde gördüğü mikro-an.
 * Giriş spring easing'li, çıkış kısa fade; hover'da sayaç durur;
 * ikon + ton çizgisi + kapatma; role=status ile ekran okuyucuya duyurulur.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [Items, setItemsView] = useState<ComponentType<ToastItemsProps> | null>(() => LoadedItems);
  const ensureItems = useCallback(() => {
    if (LoadedItems) {
      const C = LoadedItems;
      setItemsView(() => C);
      return;
    }
    loadItems().then(
      (C) => setItemsView(() => C),
      () => undefined,
    );
  }, []);
  useEffect(() => runWhenIdle(ensureItems), [ensureItems]);
  // `holds`: süreyi durduran etken sayısı (fare üstünde + odak içinde); ikisi de bitince sayaç kaldığı yerden sürer.
  const timers = useRef<Map<number, { timeout: number; remaining: number; startedAt: number; holds: number }>>(
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
      timers.current.set(id, { timeout, remaining: ms, startedAt: Date.now(), holds: 0 });
    },
    [remove],
  );

  const push = useCallback<PushFn>(
    (message, tone = "ok", opts) => {
      const id = Date.now() + Math.random();
      ensureItems();
      setItems((prev) => [...prev, { id, message, tone, action: opts?.action }]);
      schedule(id, opts?.action ? ACTION_DURATION : DURATION);
    },
    [schedule, ensureItems],
  );

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    timer.holds += 1;
    if (timer.holds > 1) return;
    window.clearTimeout(timer.timeout);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (!timer || timer.holds === 0) return;
      timer.holds -= 1;
      if (timer.holds > 0) return;
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
        // Mobilde tam genişlik ve alt gezinmenin üstünde (MP4); masaüstünde sağ alt köşe.
        className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--mobile-nav-offset,0px)+0.75rem)] z-[80] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[min(360px,calc(100vw-2rem))] lg:bottom-4"
      >
        {/* Bildirim kartları ayrı parçada (`toast-items.tsx`): kabuk ilk yük paketine girmez; boşta önceden iner, ilk
            bildirimde (henüz inmediyse) hemen istenir. Kapsayıcı (role=status, aria-live) her zaman DOM'dadır. */}
        {Items && items.length > 0 ? <Items items={items} onPause={pause} onResume={resume} onRemove={remove} /> : null}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) return { push: ((_m: string, _t?: Tone, _o?: { action?: ToastAction }) => undefined) as PushFn };
  return ctx;
}
