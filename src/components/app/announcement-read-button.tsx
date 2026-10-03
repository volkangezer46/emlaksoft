"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { markAnnouncementRead } from "@/app/actions/announcements";
import { useToast } from "@/components/app/toast-provider";
import { runOptimistic } from "@/lib/optimistic";

/**
 * Duyuru bandındaki "Okudum" butonu — tıklanınca satır ANINDA "Okundu" olur,
 * announcement_reads upsert'i arkada çalışır; hatada buton geri gelir + toast.
 * markAnnouncementRead zaten revalidatePath("/app") yapıyor (action yanıtı taze
 * sayfayı getirir) — ayrıca router.refresh() çağrılmaz.
 */
export function AnnouncementReadButton({ id }: { id: string }) {
  const { push } = useToast();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-mint-600 opacity-70 transition-opacity">
        <Check className="h-3.5 w-3.5" /> Okundu
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        void runOptimistic({
          apply: () => setDone(true),
          commit: () => markAnnouncementRead(id),
          rollback: () => setDone(false),
          onError: (m) => push(m, "err"),
          fallbackError: "Okundu işaretlenemedi",
        })
      }
      className="focus-ring press mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-text-muted transition hover:border-mint-500/40 hover:text-mint-600 disabled:opacity-60"
    >
      <Check className="h-3.5 w-3.5" />
      Okudum
    </button>
  );
}
