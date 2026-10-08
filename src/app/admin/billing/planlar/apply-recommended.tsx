"use client";

import { Button } from "@/components/ui/button";
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
        <Button variant="outline" size="sm" type="button" onClick={() => setConfirm(true)}>
          Önerilen kataloğu uygula
        </Button>
      ) : (
        <>
          <span className="text-xs text-text-muted">Tüm paket düzenlemelerinin üzerine yazılır. Mevcut abonelikler kendi tutarını korur.</span>
          <Button variant="navy" size="sm"
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 const r = await applyRecommendedCatalog();
 setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Uygulandı." });
 setConfirm(false);
 if (!r.error) router.refresh();
 })
 }>
            {pending ? "Uygulanıyor…" : "Onayla"}
          </Button>
          <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-3 text-xs font-semibold text-text-muted">Vazgeç</button>
        </>
      )}
      {msg ? <span role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>{msg.text}</span> : null}
    </div>
  );
}
