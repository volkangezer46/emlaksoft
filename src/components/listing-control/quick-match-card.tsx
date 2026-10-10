"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decidePortalMatch } from "@/app/actions/listing-control-inventory";

/** Tek tık eşleşme kararı: "Evet, aynı" portföye bağlar, "Hayır" reddeder (sunucuda `lc_match_decide`, yalnız yönetim kademesi). */
export function QuickMatchActions({ candidateId, propertyId }: { candidateId: string; propertyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(action: "link" | "ignore") {
    setError(null);
    const fd = new FormData();
    fd.set("candidate_id", candidateId);
    fd.set("action", action);
    if (action === "link") fd.set("property_id", propertyId);
    start(async () => {
      const r = await decidePortalMatch(fd);
      if (r.error) return setError(r.error);
      setDone(action === "link" ? "Portföye bağlandı." : "Eşleşme reddedildi.");
      router.refresh();
    });
  }

  if (done) return <p role="status" className="text-sm font-semibold text-text">{done}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button type="button" size="sm" icon={Check} loading={pending} onClick={() => run("link")}>Evet, aynı</Button>
        <Button type="button" size="sm" variant="secondary" icon={X} disabled={pending} onClick={() => run("ignore")}>Hayır</Button>
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
