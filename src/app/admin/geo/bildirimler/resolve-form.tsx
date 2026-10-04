"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveGeoRequest } from "@/app/actions/geo-admin";

/** Satır içi onay/red (popup yok). */
export function ResolveForm({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected", note: string) {
    const f = new FormData();
    f.set("id", id);
    f.set("decision", decision);
    f.set("note", note);
    start(async () => {
      const r = await resolveGeoRequest(f);
      if (r.ok) router.refresh();
      else setError(r.error ?? "İşlem yapılamadı.");
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const note = String(new FormData(e.currentTarget).get("note") ?? "");
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        decide(submitter?.value === "rejected" ? "rejected" : "approved", note);
      }}
    >
      <input name="note" aria-label="Karar notu" placeholder="Not (ops.)" maxLength={500} className="min-w-[200px] flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand-400" />
      <button type="submit" value="approved" disabled={pending} className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Onayla</button>
      <button type="submit" value="rejected" disabled={pending} className="rounded-[var(--radius-control)] border border-danger-500/40 px-3 py-1.5 text-xs font-semibold text-danger-500 disabled:opacity-60">Reddet</button>
      {error ? <p role="alert" className="w-full text-xs text-danger-500">{error}</p> : null}
    </form>
  );
}
