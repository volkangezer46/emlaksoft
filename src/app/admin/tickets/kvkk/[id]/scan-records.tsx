"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { approveKvkkPhoneMatches, type AdminKvkkResult } from "@/app/actions/admin-kvkk-requests";
import { MATCH_BASIS_LABELS, RELATED_LABELS, SCANNED_KIND_LABELS, type ScannedRecord } from "@/lib/compliance/platform-kvkk";
import { cn } from "@/lib/utils";

/**
 * Taramada bulunan kayıtlar (ofis, maskeli ad, tür, eşleşme gerekçesi). Doğrulanmış e-postayla eşleşenler kapsamdadır;
 * yalnız telefonla eşleşenler (telefon doğrulanmadı, başka kişiye ait olabilir) personel tek tek işaretleyip kaydedene
 * kadar veri paketine ve silmeye girmez. Silme uygulandıktan ya da başvuru sonuçlandıktan sonra liste salt okunurdur.
 */
export function KvkkScanRecords({ id, records, approved, editable }: { id: string; records: ScannedRecord[]; approved: string[]; editable: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminKvkkResult | null>(null);
  const approvedSet = new Set(approved);
  const phoneCount = records.filter((r) => r.matchedBy === "phone").length;

  if (records.length === 0) return null;

  const list = (
    <ul className="divide-y divide-[var(--line)] rounded-[var(--radius-control)] border border-line text-xs">
      {records.map((r) => {
        const phone = r.matchedBy === "phone";
        const inScope = !phone || approvedSet.has(r.key);
        const related = Object.entries(r.related).filter(([, n]) => n > 0);
        return (
          <li key={r.key} className={cn("flex items-start gap-2.5 px-3 py-2", !inScope && "bg-amber-400/5")}>
            {phone ? (
              <input
                type="checkbox"
                name="kayit"
                value={r.key}
                defaultChecked={approvedSet.has(r.key)}
                disabled={!editable}
                aria-label={`${r.office} · ${r.name} kaydını kapsama al`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              />
            ) : (
              <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink-950">
                {r.office} · {r.name}
              </span>
              <span className="text-text-muted">
                {SCANNED_KIND_LABELS[r.kind]} · eşleşme: {MATCH_BASIS_LABELS[r.matchedBy]}
                {related.length ? ` · ${related.map(([k, n]) => `${RELATED_LABELS[k] ?? k} ${n}`).join(", ")}` : ""}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 font-semibold",
                inScope ? "bg-mint-500/10 text-mint-700" : "bg-amber-400/15 text-amber-800",
              )}
            >
              {inScope ? "Kapsamda" : "Onay bekliyor"}
            </span>
          </li>
        );
      })}
    </ul>
  );

  if (!phoneCount || !editable) return list;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("id", id);
        start(async () => setResult(await approveKvkkPhoneMatches(fd)));
      }}
      className="space-y-2"
    >
      <p className="text-xs text-text-muted">
        Telefon numarası doğrulanmadı: yalnız telefonla eşleşen kayıt başka bir kişiye ait olabilir. Ofis ve adı başvuruyla uyuşan kayıtları işaretleyip
        kaydedin; işaretlenmeyenler veri paketine ve silmeye girmez.
      </p>
      {list}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" loading={pending}>
          Telefon eşleşmesi kapsamını kaydet
        </Button>
        {result ? (
          <p role={result.error ? "alert" : "status"} className={cn("text-xs font-semibold", result.error ? "text-danger-600" : "text-mint-700")}>
            {result.error ?? result.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
