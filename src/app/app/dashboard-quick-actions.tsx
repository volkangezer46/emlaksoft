"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { completeTask } from "@/app/actions/tasks";

/**
 * Görev satırı sarmalayıcı — hover'da "Tamamla" butonu belirir; tıklayınca
 * iyimser soluklaşma + server action + router.refresh. Satır linki children
 * içinde kalır, buton z-10 ile üstünde durur.
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
  const [, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <div className={`group/task relative transition-opacity duration-300 ${done ? "pointer-events-none opacity-40" : ""}`}>
      {children}
      {showAction && !done ? (
        <button
          type="button"
          onClick={() => {
            setDone(true);
            startTransition(async () => {
              const fd = new FormData();
              fd.set("id", id);
              await completeTask(fd);
              router.refresh();
            });
          }}
          className="hover-action focus-ring press absolute right-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-[var(--radius-control)] bg-mint-500 px-2.5 py-1.5 text-xs font-bold text-white opacity-0 shadow-sm transition hover:bg-mint-600 focus-visible:opacity-100 group-hover/task:opacity-100"
        >
          <Check className="h-3.5 w-3.5" /> Tamamla
        </button>
      ) : null}
      {done ? (
        <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-[var(--radius-control)] bg-mint-500/15 px-2.5 py-1.5 text-xs font-bold text-mint-600">
          Tamamlandı ✓
        </span>
      ) : null}
    </div>
  );
}
