"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateOpenHouseStatus } from "@/app/actions/open-house";

const OPTIONS = [
  { value: "planned", label: "Planlandı" },
  { value: "active", label: "Devam ediyor" },
  { value: "completed", label: "Tamamlandı" },
  { value: "cancelled", label: "İptal" },
];

export function StatusSelect({ openHouseId, status }: { openHouseId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    if (next === status) return;
    setError(null);
    startTransition(async () => {
      const res = await updateOpenHouseStatus(openHouseId, next);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor="oh-status" className="text-xs font-semibold text-text-muted">
        Durum
      </label>
      <select
        id="oh-status"
        value={status}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink-950 outline-none transition hover:border-brand-300 disabled:opacity-60"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" /> : null}
      {error ? <span className="text-xs text-danger-500" role="alert">{error}</span> : null}
    </span>
  );
}
