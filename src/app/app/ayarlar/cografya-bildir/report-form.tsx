"use client";

import { useState, useTransition } from "react";
import { GeoSelect } from "@/components/app/geo-select";
import { submitGeoChangeRequest } from "@/app/actions/geo-request";
import type { GeoOption } from "@/lib/geo/types";

const field =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/** Eksik/yanlış mahalle bildirimi — satır içi form (popup yok). */
export function GeoReportForm({ provinces }: { provinces: GeoOption[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kind, setKind] = useState<"missing" | "wrong">("missing");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        start(async () => {
          const r = await submitGeoChangeRequest(data);
          if (r.ok) {
            form.reset();
            setMsg({ ok: true, text: "Bildiriminiz alındı. Ekibimiz inceleyip dönüş yapacak." });
          } else setMsg({ ok: false, text: r.error ?? "Gönderilemedi." });
        });
      }}
    >
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Bildirim türü</legend>
        <label className="flex items-center gap-2"><input type="radio" name="kind" value="missing" checked={kind === "missing"} onChange={() => setKind("missing")} /> Mahalle eksik</label>
        <label className="flex items-center gap-2"><input type="radio" name="kind" value="wrong" checked={kind === "wrong"} onChange={() => setKind("wrong")} /> Mahalle adı yanlış</label>
      </fieldset>
      <GeoSelect provinces={provinces} required withNeighborhood={kind === "wrong"} />
      <label className="block text-sm font-medium text-ink-950">
        {kind === "missing" ? "Eksik mahallenin adı" : "Doğru ad"}
        <input name="proposed_name" required minLength={2} maxLength={160} className={`${field} mt-1.5`} />
      </label>
      <label className="block text-sm font-medium text-ink-950">
        Not (isteğe bağlı)
        <textarea name="note" rows={3} maxLength={1000} className={`${field} mt-1.5 resize-none`} />
      </label>
      <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Gönderiliyor…" : "Bildir"}
      </button>
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success-600" : "text-danger-500"}`}>{msg.text}</p> : null}
    </form>
  );
}
