"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSeatSettings } from "@/app/actions/platform-billing-plans";
import { opFieldClass } from "../inline-op";

/** Koltuk doluluk uyarı eşiği (ofis tarafı satın alma yönlendirmesi bunu kullanır). Satır içi, popup yok. */
export function SeatSettingsForm({ warnPercent }: { warnPercent: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (pending) return;
        start(async () => {
          const r = await saveSeatSettings(fd);
          setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Kaydedildi." });
          if (!r.error) router.refresh();
        });
      }}
    >
      <label className="block text-xs font-semibold text-text-muted">
        Doluluk uyarı eşiği (%)
        <input name="warn_percent" required inputMode="numeric" defaultValue={warnPercent} className={`mt-1 w-28 ${opFieldClass}`} />
      </label>
      <Button variant="navy" size="sm" type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Eşiği kaydet"}
      </Button>
      <p className="basis-full text-xs text-text-muted">%100 ve üstü &quot;dolu&quot; sayılır. Ofis tarafında bu eşikte ek kullanıcı satın alma yönlendirmesi gösterilir.</p>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`basis-full text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
