"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <Input name="note" aria-label="Karar notu" placeholder="Not (ops.)" maxLength={500} className="min-w-[200px] flex-1" />
      <Button variant="primary" size="sm" type="submit" value="approved" disabled={pending}>Onayla</Button>
      <Button variant="outline" size="sm" type="submit" value="rejected" disabled={pending} className="text-danger-500">Reddet</Button>
      {error ? <p role="alert" className="w-full text-xs text-danger-500">{error}</p> : null}
    </form>
  );
}
