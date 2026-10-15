"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, CheckCircle2, MessageCircle } from "lucide-react";
import { SwipeRow } from "@/components/ui/swipe-row";
import { useToast } from "@/components/app/toast-provider";
import { completeTask, reopenTask, rescheduleTasks } from "@/app/actions/tasks";

/**
 * GA-10 mobil ajanda kaydırmaları (yalnız dokunmatik). Randevu: sağa = tamamlama paneli (`?randevu=<id>&tamamla=1`),
 * sola = WhatsApp'tan teyit mesajı. Görev: sağa = Tamamla (geri alınabilir), sola = yarın 10:00.
 */
export function ApptSwipe({
  id,
  canComplete,
  waHref,
  children,
}: {
  id: string;
  canComplete: boolean;
  waHref: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <SwipeRow
      right={canComplete ? { label: "Tamamla", icon: CheckCircle2, tone: "success", onAction: () => router.push(`/app/randevular?randevu=${id}&tamamla=1`) } : null}
      left={waHref ? { label: "Teyit gönder", icon: MessageCircle, tone: "brand", onAction: () => window.open(waHref, "_blank", "noopener,noreferrer") } : null}
    >
      {children}
    </SwipeRow>
  );
}

export function TaskSwipe({ id, canEdit, children }: { id: string; canEdit: boolean; children: ReactNode }) {
  const router = useRouter();
  const { push } = useToast();
  const fd = () => {
    const f = new FormData();
    f.set("id", id);
    return f;
  };
  return (
    <SwipeRow
      disabled={!canEdit}
      right={{
        label: "Tamamla",
        icon: CheckCircle2,
        tone: "success",
        onAction: async () => {
          await completeTask(fd());
          push("Görev tamamlandı", "ok", {
            action: {
              label: "Geri al",
              onClick: async () => {
                await reopenTask(fd());
                router.refresh();
              },
            },
          });
          router.refresh();
        },
      }}
      left={{
        label: "Yarın 10:00",
        icon: AlarmClock,
        tone: "warning",
        onAction: async () => {
          const res = await rescheduleTasks([id], "tomorrow10");
          push(res.error ?? "Görev yarın 10:00'a taşındı", res.error ? "err" : "ok");
          router.refresh();
        },
      }}
    >
      {children}
    </SwipeRow>
  );
}
