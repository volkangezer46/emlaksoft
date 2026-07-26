"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check } from "lucide-react";
import { completeTask } from "@/app/actions/tasks";
import { updateAppointmentStatus } from "@/app/actions/appointments";

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
          className="hover-action focus-ring press absolute right-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-[8px] bg-mint-500 px-2.5 py-1.5 text-xs font-bold text-white opacity-0 shadow-sm transition hover:bg-mint-600 focus-visible:opacity-100 group-hover/task:opacity-100"
        >
          <Check className="h-3.5 w-3.5" /> Tamamla
        </button>
      ) : null}
      {done ? (
        <span className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-[8px] bg-mint-500/15 px-2.5 py-1.5 text-xs font-bold text-mint-600">
          Tamamlandı ✓
        </span>
      ) : null}
    </div>
  );
}

/** Randevu hızlı onayı — pending durumdaki satırda hover'da görünür. */
export function AppointmentConfirmButton({ id }: { id: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);

  if (confirmed) {
    return (
      <span className="rounded-[8px] bg-mint-500/15 px-2 py-1 text-xs font-bold text-mint-600">
        Onaylandı ✓
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setConfirmed(true);
        startTransition(async () => {
          const fd = new FormData();
          fd.set("id", id);
          fd.set("status", "confirmed");
          await updateAppointmentStatus(fd);
          router.refresh();
        });
      }}
      className="focus-ring press inline-flex items-center gap-1 rounded-[8px] bg-brand-600 px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700"
    >
      <CalendarCheck className="h-3.5 w-3.5" /> Onayla
    </button>
  );
}
