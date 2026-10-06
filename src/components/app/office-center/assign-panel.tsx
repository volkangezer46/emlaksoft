"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, UserPlus } from "lucide-react";
import { assignFromPool, suggestAssignees } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-controls";
import type { SmartSuggestion } from "@/lib/office-center/smart-assign";

export type AssignOption = { id: string; name: string };

/**
 * Tek ilan için atama paneli: "Akıllı öner" → ilk 3 kart (puan + gerekçe satırları) → tek tık "Ata";
 * ya da elle danışman seçip ata. Sunucu kuralları (şube kısıtı, eleme) assignFromPool içinde yeniden doğrulanır.
 */
export function AssignPanel({ propertyId, advisors, canAssign }: { propertyId: string; advisors: AssignOption[]; canAssign: boolean }) {
  const [suggestions, setSuggestions] = useState<SmartSuggestion[] | null>(null);
  const [excludedCount, setExcludedCount] = useState(0);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const { push } = useToast();

  if (!canAssign) return <p className="text-xs text-text-muted">Atama yetkiniz yok (ofis merkezi düzenleme izni gerekir).</p>;

  function suggest() {
    setError(null);
    start(async () => {
      const res = await suggestAssignees(propertyId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSuggestions(res.suggestions ?? []);
      setExcludedCount(res.excludedCount ?? 0);
    });
  }

  function assign(advisorId: string, method: "smart" | "manual") {
    if (!advisorId) return;
    setError(null);
    setBusyId(advisorId);
    start(async () => {
      const res = await assignFromPool({ propertyId, advisorId, method, reason: "" });
      setBusyId(null);
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      push(res.message ?? "Atandı.", "ok");
      if (res.warning) push(res.warning, "info");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" icon={Sparkles} loading={pending && busyId === null && suggestions === null} onClick={suggest}>
          {suggestions ? "Öneriyi yenile" : "Akıllı öner"}
        </Button>
        <span className="text-xs text-text-muted">veya</span>
        <label className="sr-only" htmlFor={`oc-manual-${propertyId}`}>
          Elle danışman seç
        </label>
        <FormSelect id={`oc-manual-${propertyId}`} className="h-8 w-auto px-2 py-1 text-xs" value={manual} onChange={(e) => setManual(e.target.value)}>
          <option value="">Elle danışman seç…</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FormSelect>
        <Button type="button" variant="secondary" size="sm" icon={UserPlus} disabled={!manual} loading={pending && busyId === manual && manual !== ""} onClick={() => assign(manual, "manual")}>
          Elle ata
        </Button>
      </div>
      {error ? (
        <Alert tone="danger" title="İşlem yapılamadı">
          {error}
        </Alert>
      ) : null}
      {suggestions ? (
        suggestions.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line px-3 py-3 text-sm text-text-muted">
            Uygun danışman bulunamadı{excludedCount ? ` (${excludedCount} aday elendi: pasif, izinli, havuza kapalı, kapasite dolu veya şube dışı)` : ""}. Elle atama yapabilirsiniz.
          </p>
        ) : (
          <ol className="grid gap-2 md:grid-cols-3" aria-label="Akıllı öneriler">
            {suggestions.map((s, i) => (
              <li key={s.profileId} className={`rounded-[var(--radius-card)] border p-3 ${i === 0 ? "border-brand-400 bg-brand-50/40" : "border-line bg-surface"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">
                      {i + 1}. {s.name}
                    </p>
                    <p className="text-xs text-text-muted">{s.summary}</p>
                  </div>
                  <span className="numeric shrink-0 rounded-full bg-ink-950 px-2 py-0.5 text-xs font-bold text-white" aria-label={`Puan ${s.score}`}>
                    {s.score}
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-text-muted">
                  {s.reasons.map((r) => (
                    <li key={r.key} className="flex justify-between gap-2">
                      <span className="truncate" title={r.detail}>
                        {r.label}
                        {r.detail ? ` · ${r.detail}` : ""}
                      </span>
                      <span className="numeric shrink-0 font-semibold text-ink-950">
                        {r.points}/{r.max}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button type="button" size="sm" className="mt-3 w-full" variant={i === 0 ? "primary" : "secondary"} loading={pending && busyId === s.profileId} onClick={() => assign(s.profileId, "smart")}>
                  Ata
                </Button>
              </li>
            ))}
          </ol>
        )
      ) : null}
      {suggestions && excludedCount > 0 && suggestions.length > 0 ? <p className="text-xs text-text-faint">{excludedCount} aday elendi (pasif, izinli, havuza kapalı, kapasite dolu veya şube dışı).</p> : null}
    </div>
  );
}
