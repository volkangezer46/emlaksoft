"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decidePortalMatch } from "@/app/actions/listing-control-inventory";

/**
 * Eşleşme kuyruğu eylemleri: Onayla (seçili aday portföye bağla) · Reddet · Başka portföy (portföy koduyla bağla).
 * Karar sunucuda `lc_match_decide` ile verilir (JWT; yalnız yönetim kademesi); aynı ilan no başka portföye bağlıysa reddedilir.
 */
export function MatchActions({ candidateId, options }: { candidateId: string; options: { propertyId: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(options[0]?.propertyId ?? "");
  const [code, setCode] = useState("");
  const [other, setOther] = useState(options.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(action: "link" | "ignore") {
    setError(null);
    const fd = new FormData();
    fd.set("candidate_id", candidateId);
    fd.set("action", action);
    if (action === "link") {
      if (other) {
        if (!code.trim()) return setError("Portföy kodunu girin.");
        fd.set("property_code", code.trim());
      } else {
        if (!selected) return setError("Bir aday seçin.");
        fd.set("property_id", selected);
      }
    }
    start(async () => {
      const r = await decidePortalMatch(fd);
      if (r.error) return setError(r.error);
      setDone(action === "link" ? "Portföye bağlandı." : "Reddedildi.");
      router.refresh();
    });
  }

  if (done) return <p role="status" className="text-sm font-semibold text-text">{done}</p>;

  return (
    <div className="flex w-full flex-col gap-2 md:w-72">
      {options.length > 0 && !other ? (
        <label className="text-xs font-medium text-text-muted">
          Bağlanacak portföy
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm text-text outline-none focus:border-brand-400"
          >
            {options.map((o) => (
              <option key={o.propertyId} value={o.propertyId}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="text-xs font-medium text-text-muted">
          Portföy kodu
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={40}
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm text-text outline-none focus:border-brand-400"
            placeholder="P-1024"
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" icon={Check} loading={pending} onClick={() => run("link")}>
          Onayla
        </Button>
        <Button type="button" size="sm" variant="secondary" icon={X} disabled={pending} onClick={() => run("ignore")}>
          Reddet
        </Button>
        {options.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOther((v) => !v)}>
            {other ? "Adaylardan seç" : "Başka portföy seç"}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
