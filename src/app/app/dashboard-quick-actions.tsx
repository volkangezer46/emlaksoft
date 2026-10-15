"use client";

import { lazy, Suspense, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, CheckCircle2 } from "lucide-react";
import { completeTask, reopenTask, rescheduleTasks } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";

/**
 * Kaydırma sarmalayıcısı (SwipeRow) ana ekranın ilk yük JS'ine girmez (ayrı parça): yüklenene dek satır aynı içerikle düz
 * çizilir (Suspense yedeği), görünür "Tamamla" düğmesi zaten çalışır.
 */
const LazySwipeRow = lazy(() => import("@/components/ui/swipe-row").then((m) => ({ default: m.SwipeRow })));

/**
 * Ana ekran görev satırı sarmalayıcı — "Tamamla" butonu (masaüstünde hover/odakta, dokunmatikte her zaman görünür;
 * `.hover-action`); tıklayınca iyimser soluklaşma + server action + router.refresh, "Geri al" toast'u ile.
 * GA-10: dokunmatikte sağa kaydırma = Tamamla, sola = "Yarın 10:00" (görev sayfasındaki kartla aynı eylemler; SwipeRow
 * fare/kalemde etkin değildir, görünür düğme klavye ve ekran okuyucu için kalır). Satır linki children içinde kalır,
 * buton z-10 ile üstünde durur.
 */
export function TaskQuickRow({
  id,
  showAction = true,
  children,
}: {
  id: string;
  showAction?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function undo() {
    setDone(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await reopenTask(fd);
      if (res.error) push(res.error, "err");
      router.refresh();
    });
  }

  function complete() {
    setDone(true);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await completeTask(fd);
      push("Görev tamamlandı", "ok", { action: { label: "Geri al", onClick: undo } });
      router.refresh();
    });
  }

  function tomorrow() {
    setDone(true);
    startTransition(async () => {
      const res = await rescheduleTasks([id], "tomorrow10");
      if (res.error) {
        setDone(false);
        push(res.error, "err");
        return;
      }
      push("Görev yarın 10:00'a taşındı", "ok");
      router.refresh();
    });
  }

  const row = (
    <div className={`group/task relative transition-opacity duration-300 ${done ? "pointer-events-none opacity-40" : ""}`}>
      {children}
      {showAction && !done ? (
        <button
          type="button"
          onClick={complete}
          className="hover-action focus-ring press absolute right-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-[var(--radius-control)] bg-mint-500 px-2.5 py-1.5 text-xs font-bold text-white opacity-0 shadow-sm transition hover:bg-mint-600 focus-visible:opacity-100 group-hover/task:opacity-100 touch:min-h-11"
        >
          <Check className="h-3.5 w-3.5" /> Tamamla
        </button>
      ) : null}
      {done ? (
        <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-[var(--radius-control)] bg-mint-500/15 px-2.5 py-1.5 text-xs font-bold text-mint-600">
          Güncellendi ✓
        </span>
      ) : null}
    </div>
  );
  if (!showAction) return row;
  return (
    <Suspense fallback={row}>
      <LazySwipeRow
        disabled={done || pending}
        right={{ label: "Tamamla", icon: CheckCircle2, tone: "success", onAction: complete }}
        left={{ label: "Yarın 10:00", icon: AlarmClock, tone: "warning", onAction: tomorrow }}
      >
        {row}
      </LazySwipeRow>
    </Suspense>
  );
}
