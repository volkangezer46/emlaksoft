"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyTenantGeoBackfill } from "@/app/actions/geo-admin";

/** Satır içi eşleştirme onayı: seçili ofis(ler) için il kimliğini yazar. */
export function ApplyMatchButton({ ids, label, allowFuzzy = false }: { ids: string[]; label: string; allowFuzzy?: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    const f = new FormData();
    f.set("ids", ids.join(","));
    if (allowFuzzy) f.set("allow_fuzzy", "on");
    start(async () => {
      const r = await applyTenantGeoBackfill(f);
      setMsg(r.ok ? r.message ?? "Eşleştirildi." : r.error ?? "Yapılamadı.");
      setConfirm(false);
      if (r.ok) router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-xs text-text-muted">{ids.length} ofisin il kimliği ve gösterim adı yazılacak.</span>
          <button type="button" disabled={pending} onClick={run} className="rounded-[var(--radius-control)] bg-brand-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60">Onayla</button>
          <button type="button" onClick={() => setConfirm(false)} className="rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs text-text-muted">Vazgeç</button>
        </>
      ) : (
        <button type="button" disabled={ids.length === 0} onClick={() => setConfirm(true)} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold hover:border-brand-400 disabled:opacity-50">{label}</button>
      )}
      {msg ? <span role="status" className="text-xs text-text-muted">{msg}</span> : null}
    </span>
  );
}
