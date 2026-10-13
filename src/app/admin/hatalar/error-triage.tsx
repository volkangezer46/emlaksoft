"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonSelect } from "@/components/ui/person-select";
import { triageErrorLog } from "@/app/actions/platform-ops";

const field =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm text-ink-950 outline-none focus:border-brand-300";

/**
 * Hata triyajı: durum (açık / yok sayıldı / ertelendi / çözüldü), atanan kişi ve not. Yok sayılan ve ertelenen hata
 * "hata patlaması" uyarısına ve anlık hata akışına girmez; erteleme süresi dolunca kayıt kendiliğinden açılır.
 */
export function ErrorTriageForm({
  id,
  status,
  assigneeId,
  note,
  staff,
}: {
  id: string;
  status: string;
  assigneeId: string | null;
  note: string | null;
  staff: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(status);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", id);
    setRes(null);
    start(async () => {
      const r = await triageErrorLog(fd);
      setRes(r.error ? { ok: false, text: r.error } : { ok: true, text: "Kaydedildi." });
      router.refresh();
    });
  }

  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /> Triyaj (durum, atanan, not)
      </summary>
      <form onSubmit={onSubmit} className="mt-2 grid gap-3 rounded-[var(--radius-control)] border border-line bg-canvas p-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          Durum
          <select name="status" value={current} onChange={(e) => setCurrent(e.target.value)} className={field}>
            <option value="open">Açık</option>
            <option value="ignored">Yok sayıldı</option>
            <option value="snoozed">Ertelendi</option>
            <option value="resolved">Çözüldü</option>
          </select>
        </label>
        {current === "snoozed" ? (
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            Erteleme (saat)
            <input name="snoozeHours" type="number" inputMode="numeric" min={1} max={720} defaultValue={24} className={field} />
          </label>
        ) : null}
        <div className="grid gap-1 text-xs font-semibold text-text-muted">
          Atanan
          <PersonSelect people={staff} name="assignee" defaultValue={assigneeId ?? ""} emptyLabel="Atanmadı" clearable aria-label="Atanan kişi" />
        </div>
        <label className="grid gap-1 text-xs font-semibold text-text-muted sm:col-span-3">
          Not
          <textarea
            name="note"
            defaultValue={note ?? ""}
            maxLength={2000}
            rows={2}
            placeholder="Kök neden, ilgili iş, geçici çözüm…"
            className="focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button variant="navy" size="sm" type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Kaydet
          </Button>
          {res ? (
            <span role={res.ok ? "status" : "alert"} className={`text-xs font-semibold ${res.ok ? "text-mint-700" : "text-danger-600"}`}>
              {res.text}
            </span>
          ) : null}
        </div>
      </form>
    </details>
  );
}
