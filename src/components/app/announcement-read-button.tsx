"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { markAnnouncementRead } from "@/app/actions/announcements";

/**
 * Duyuru bandındaki "Okudum" butonu — tıklanınca announcement_reads'e upsert,
 * satır anında soluklaşır (done state), router.refresh sıralamayı tazeler.
 */
export function AnnouncementReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-mint-600 opacity-70 transition-opacity">
        <Check className="h-3.5 w-3.5" /> Okundu
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markAnnouncementRead(id);
          if (!res.error) {
            setDone(true);
            router.refresh();
          }
        })
      }
      className="focus-ring press mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-bold text-text-muted transition hover:border-mint-500/40 hover:text-mint-600 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      Okudum
    </button>
  );
}
