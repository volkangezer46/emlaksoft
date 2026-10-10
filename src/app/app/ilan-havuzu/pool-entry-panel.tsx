"use client";

import { useState, useTransition } from "react";
import { Hand, RefreshCw, SkipForward, Timer, Trophy, UserCheck } from "lucide-react";
import { assignPoolEntry, claimPoolEntry, openPoolClaimWindow, refreshPoolSuggestions, skipPoolEntry } from "@/app/actions/listing-pool";
import { useToast } from "@/components/app/toast-provider";

export type PanelSuggestion = {
  profileId: string;
  name: string;
  score: number;
  reasons: { key: string; label: string; points: number; max: number; detail?: string }[];
  excludedReason?: string;
};

const BTN =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";

/**
 * Havuz kaydının işlem paneli (satır içi, popup değil): öneri listesi + "neden bu danışman" dökümü +
 * mod'a göre atama / sahiplenme / atlama. Sunucu işlemleri `listing-pool` action'larındadır.
 */
export function PoolEntryPanel({
  entryId,
  mode,
  canManage,
  claimOpen,
  suggestions,
  assignedName,
}: {
  entryId: string;
  mode: "manual" | "semi_auto" | "auto" | "claim";
  canManage: boolean;
  claimOpen: boolean;
  suggestions: PanelSuggestion[];
  assignedName?: string | null;
}) {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [skipOpen, setSkipOpen] = useState(false);
  const [reason, setReason] = useState("");
  const eligible = suggestions.filter((s) => !s.excludedReason);
  const excluded = suggestions.filter((s) => s.excludedReason);
  const shown = mode === "manual" ? eligible : eligible.slice(0, 3);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, okMessage: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) push(okMessage, "ok");
      else push(res.error ?? "İşlem yapılamadı.", "err");
    });
  }

  return (
    <div className="space-y-3">
      {claimOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <Hand className="h-4 w-4" />
          <span className="font-semibold">Kendine almaya açık:</span>
          <span>İlk alan danışmanın olur.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => claimPoolEntry(entryId), "İlanı kendine aldın.")}
            className={`${BTN} ml-auto bg-brand-600 text-white hover:bg-brand-700`}
          >
            <Hand className="h-3.5 w-3.5" /> Kendine al
          </button>
        </div>
      ) : null}

      {canManage ? (
        <>
          {shown.length > 0 ? (
            <ul className="space-y-2">
              {shown.map((s, i) => (
                <li key={s.profileId} className="rounded-[var(--radius-control)] border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {i === 0 ? <Trophy className="h-4 w-4 text-amber-600" aria-label="En iyi öneri" /> : null}
                    <span className="font-semibold text-ink-950">{s.name}</span>
                    <span className="numeric rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">{s.score}/100</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => assignPoolEntry(entryId, s.profileId, mode === "manual" ? "manual" : "suggested"),
                          `${s.name} atandı.`,
                        )
                      }
                      className={`${BTN} ml-auto bg-ink-950 text-white hover:bg-ink-800`}
                    >
                      <UserCheck className="h-3.5 w-3.5" /> {mode === "manual" ? "Ata" : i === 0 ? "Onayla ve ata" : "Bunu ata"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-text-muted">Neden bu danışman</p>
                  <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-text-muted sm:grid-cols-2">
                    {s.reasons.map((r) => (
                      <li key={r.key} className="flex items-baseline justify-between gap-2">
                        <span>
                          {r.label}
                          {r.detail ? <span className="text-text-faint"> · {r.detail}</span> : null}
                        </span>
                        <span className={`numeric shrink-0 font-semibold ${r.points > 0 ? "text-ink-950" : "text-text-faint"}`}>
                          +{r.points}/{r.max}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-3 text-sm text-text-muted">
              Uygun danışman yok: aşağıdaki nedenlerle hepsi elendi ya da ofiste atanabilir kullanıcı yok. Danışman uzmanlık ve
              kapasite ayarlarını Ekip sayfasından güncelleyin.
            </p>
          )}

          {excluded.length > 0 ? (
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer font-semibold">Elenen danışmanlar ({excluded.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {excluded.map((s) => (
                  <li key={s.profileId}>
                    <span className="font-semibold text-ink-950">{s.name}</span> — {s.excludedReason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={() => run(() => refreshPoolSuggestions(entryId), "Öneriler güncellendi.")} className={`${BTN} border border-line bg-surface text-ink-950 hover:bg-canvas`}>
              <RefreshCw className="h-3.5 w-3.5" /> Önerileri yenile
            </button>
            {!claimOpen ? (
              <button type="button" disabled={pending} onClick={() => run(() => openPoolClaimWindow(entryId), "Kendine alma süresi açıldı.")} className={`${BTN} border border-line bg-surface text-ink-950 hover:bg-canvas`}>
                <Timer className="h-3.5 w-3.5" /> Kendine almaya aç
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => setSkipOpen((v) => !v)} className={`${BTN} border border-line bg-surface text-text-muted hover:bg-canvas`}>
              <SkipForward className="h-3.5 w-3.5" /> Atla
            </button>
          </div>
          {skipOpen ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas p-3">
              <label className="sr-only" htmlFor={`skip-${entryId}`}>Atlama gerekçesi</label>
              <input
                id={`skip-${entryId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Atlama gerekçesi (zorunlu)"
                className="min-w-[220px] flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-400"
              />
              <button
                type="button"
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  run(async () => {
                    const r = await skipPoolEntry(entryId, reason);
                    if (r.ok) setSkipOpen(false);
                    return r;
                  }, "Kayıt atlandı.")
                }
                className={`${BTN} bg-ink-950 text-white hover:bg-ink-800`}
              >
                Atla ve kapat
              </button>
            </div>
          ) : null}
        </>
      ) : !claimOpen ? (
        <p className="text-xs text-text-muted">
          {assignedName ? `Atanan: ${assignedName}` : "Atamayı ofis yönetimi yapar; kendine alma açılırsa buradan alabilirsin."}
        </p>
      ) : null}
    </div>
  );
}
