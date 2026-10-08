"use client";

import { Button } from "@/components/ui/button";
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
          <Button variant="primary" size="xs" type="button" disabled={pending} onClick={run}>Onayla</Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirm(false)}>Vazgeç</Button>
        </>
      ) : (
        <Button variant="outline" size="xs" type="button" disabled={ids.length === 0} onClick={() => setConfirm(true)}>{label}</Button>
      )}
      {msg ? <span role="status" className="text-xs text-text-muted">{msg}</span> : null}
    </span>
  );
}
