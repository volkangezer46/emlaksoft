"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyRecommendedCatalog } from "@/app/actions/platform-billing-plans";

/** Önerilen kataloğu uygula (satır içi onaylı; mevcut düzenlemelerin üzerine yazar). */
export function ApplyRecommended() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)} className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-950">
          Önerilen kataloğu uygula
        </button>
      ) : (
        <>
          <span className="text-xs text-text-muted">Tüm paket düzenlemelerinin üzerine yazılır. Mevcut abonelikler kendi tutarını korur.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await applyRecommendedCatalog();
                setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Uygulandı." });
                setConfirm(false);
                if (!r.error) router.refresh();
              })
            }
            className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          >
            {pending ? "Uygulanıyor…" : "Onayla"}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-3 text-xs font-semibold text-text-muted">Vazgeç</button>
        </>
      )}
      {msg ? <span role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>{msg.text}</span> : null}
    </div>
  );
}
