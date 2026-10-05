"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { rollbackGeoVersion } from "@/app/actions/geo-admin";

/** Satır içi onaylı geri alma (popup yok). Yalnız o sürümün değişikliklerini geri alır; silme yok. */
export function RollbackButton({ versionId, label }: { versionId: string; label: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    const f = new FormData();
    f.set("id", versionId);
    start(async () => {
      const r = await rollbackGeoVersion(f);
      setMsg({ ok: Boolean(r.ok), text: r.ok ? r.message ?? "Geri alındı." : r.error ?? "Geri alınamadı." });
      setConfirm(false);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <>
          <span className="text-xs text-text-muted">“{label}” sürümünün değişiklikleri geri alınacak (eklenenler pasife alınır, güncellenenler eski değerine döner). Referans kırılmaz.</span>
          <button type="button" disabled={pending} onClick={run} className="rounded-[var(--radius-control)] bg-danger-500 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-60">{pending ? "Geri alınıyor…" : "Geri almayı onayla"}</button>
          <button type="button" onClick={() => setConfirm(false)} className="rounded-[var(--radius-control)] border border-line px-2 py-1.5 text-xs text-text-muted">Vazgeç</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:border-danger-500/40 hover:text-danger-500">
          <Undo2 className="h-3.5 w-3.5" /> Geri al
        </button>
      )}
      {msg ? <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-success-600" : "text-danger-500"}`}>{msg.text}</span> : null}
    </div>
  );
}
