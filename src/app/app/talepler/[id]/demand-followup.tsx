"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellPlus } from "lucide-react";
import { createFollowupReminder } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";

const OPTIONS = [
  { days: 1, label: "Yarın" },
  { days: 3, label: "3 gün" },
  { days: 7, label: "1 hafta" },
  { days: 14, label: "2 hafta" },
] as const;

/**
 * Talep hatırlatıcısı: tek tıkla N gün sonra 09:00'a takip görevi açar (görev listesinde
 * ve müşteri kartında görünür; vadesi gelince günlük görev özetine girer).
 */
export function DemandReminder({ customerId, title }: { customerId: string; title: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();

  function remind(days: number, label: string) {
    startTransition(async () => {
      const res = await createFollowupReminder({ customerId, title, days });
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(`Hatırlatma kuruldu: ${label} 09:00`, "ok");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Hatırlatma kur">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted">
        <BellPlus className="h-3.5 w-3.5" aria-hidden="true" /> Hatırlat:
      </span>
      {OPTIONS.map((o) => (
        <button
          key={o.days}
          type="button"
          disabled={pending}
          onClick={() => remind(o.days, o.label)}
          className="focus-ring press rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
