"use client";

import { useRouter } from "next/navigation";
import { useState, startTransition } from "react";
import { setDemandStatus } from "@/app/actions/demands";

const STATUSES: { value: string; label: string; activeCls: string }[] = [
  { value: "new", label: "Yeni", activeCls: "bg-brand-600 text-white" },
  { value: "active", label: "Aktif", activeCls: "bg-cyan-600 text-white" },
  { value: "matched", label: "Eşleşti", activeCls: "bg-mint-600 text-white" },
  { value: "closed", label: "Kapalı", activeCls: "bg-ink-950 text-white" },
];

/** Talep detayında durum değiştirme — mevcut setDemandStatus action'ını kullanır. */
export function DemandStatusSwitch({
  demandId,
  customerId,
  status,
}: {
  demandId: string;
  customerId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: string) {
    if (next === status || pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", demandId);
    fd.set("customer_id", customerId);
    fd.set("status", next);
    const result = await setDemandStatus(fd);
    startTransition(() => {
      setPending(false);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Talep durumu">
        {STATUSES.map((s) => {
          const active = s.value === status;
          return (
            <button
              key={s.value}
              type="button"
              disabled={pending || active}
              onClick={() => apply(s.value)}
              aria-pressed={active}
              className={`focus-ring press rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:cursor-default ${
                active
                  ? s.activeCls
                  : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger-600" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
