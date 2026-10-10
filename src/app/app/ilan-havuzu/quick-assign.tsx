"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, UserCheck } from "lucide-react";
import { assignPoolEntry } from "@/app/actions/listing-pool";
import { assignFromPool } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-controls";

export type QuickSuggestion = { profileId: string; name: string; score: number; reason: string };
export type QuickTarget = { kind: "pool"; entryId: string } | { kind: "property"; propertyId: string };

/**
 * Bekleyen ilan kartının TEK TIK atama alanı: önerilen danışman (gerekçe tek satır) + "Ata". Öneri yoksa ya da başka
 * birini seçmek isteyen için küçük bir "Başka danışman" seçici. Havuz kaydı varsa `assignPoolEntry`, havuzda olmayan
 * danışmansız ilan için `assignFromPool` çalışır (iki atama modeli tek listede birleşik). Sunucu kuralları (şube kısıtı,
 * kapasite, yetki) eylemlerde yeniden doğrulanır.
 */
export function QuickAssign({
  target,
  suggestion,
  advisors,
}: {
  target: QuickTarget;
  suggestion: QuickSuggestion | null;
  advisors: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [other, setOther] = useState("");
  const router = useRouter();
  const { push } = useToast();

  function run(advisorId: string, name: string, suggested: boolean) {
    if (!advisorId) return;
    start(async () => {
      const res =
        target.kind === "pool"
          ? await assignPoolEntry(target.entryId, advisorId, suggested ? "suggested" : "manual")
          : await assignFromPool({ propertyId: target.propertyId, advisorId, method: suggested ? "smart" : "manual", reason: "" });
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(`${name} atandı.`, "ok");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-400/50 bg-brand-50/40 p-3">
          <Sparkles className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-950">
              Önerilen: {suggestion.name} <span className="numeric text-xs font-bold text-brand-700">{suggestion.score}/100</span>
            </p>
            {suggestion.reason ? <p className="truncate text-xs text-text-muted" title={suggestion.reason}>{suggestion.reason}</p> : null}
          </div>
          <Button type="button" icon={UserCheck} loading={pending} onClick={() => run(suggestion.profileId, suggestion.name, true)}>
            Ata
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Uygun bir öneri yok; aşağıdan danışman seçerek atayabilirsiniz.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`qa-${target.kind === "pool" ? target.entryId : target.propertyId}`}>
          Başka danışman seç
        </label>
        <FormSelect
          id={`qa-${target.kind === "pool" ? target.entryId : target.propertyId}`}
          className="h-10 w-auto min-w-[12rem] px-3 py-1 text-sm"
          value={other}
          onChange={(e) => setOther(e.target.value)}
        >
          <option value="">Başka danışman seç…</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FormSelect>
        <Button
          type="button"
          variant="secondary"
          disabled={!other}
          loading={pending}
          onClick={() => run(other, advisors.find((a) => a.id === other)?.name ?? "Danışman", false)}
        >
          Bu danışmana ata
        </Button>
      </div>
    </div>
  );
}
