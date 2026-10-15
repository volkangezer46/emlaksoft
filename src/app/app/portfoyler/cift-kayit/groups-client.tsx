"use client";

import { useState } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Camera, Eye, EyeOff, MapPin, MapPinOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHiddenGroups } from "@/components/app/hidden-groups-store";
import { MergeButton, MergePanel, type MergeAdapter } from "@/components/app/record-merge-wizard";
import { getPropertyMergePreview, mergeProperties } from "@/app/actions/property-merge";

export type PropertyRecordVM = {
  id: string;
  code: string;
  title: string;
  address: string | null;
  price: string;
  status: string;
  advisor: string | null;
  created: string;
  mediaCount: number;
  hasLocation: boolean;
  score: number;
};

export type PropertyGroupVM = { key: string; reasons: string[]; strong: boolean; records: PropertyRecordVM[] };

const HIDDEN_KEY = "emlaksoft:portfoy-cift-kayit:gizli-gruplar";

const ADAPTER: MergeAdapter = {
  noun: "portföy",
  preview: (primaryId, duplicateIds, overrides) => getPropertyMergePreview(primaryId, duplicateIds, overrides),
  merge: (primaryId, duplicateIds, overrides) => mergeProperties(primaryId, duplicateIds, overrides),
  recordHref: (id) => `/app/portfoyler/${id}`,
};

/** Olası çift portföy grupları: kartlar, "mükerrer değil" gizleme (cihazda) ve sayfa içi birleştirme sihirbazı. */
export function PropertyGroupsClient({ groups, canMerge }: { groups: PropertyGroupVM[]; canMerge: boolean }) {
  const { hidden, hide, unhide } = useHiddenGroups(HIDDEN_KEY);
  const [showHidden, setShowHidden] = useState(false);
  const hiddenSet = new Set(hidden);
  const hiddenCount = groups.filter((g) => hiddenSet.has(g.key)).length;
  const shown = showHidden ? groups : groups.filter((g) => !hiddenSet.has(g.key));

  return (
    <div className="space-y-4">
      {hiddenCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5">
          <p className="text-xs text-text-muted">
            <span className="numeric font-semibold">{hiddenCount}</span> grup &quot;mükerrer değil&quot; olarak işaretlendi
            (yalnızca bu cihazda gizli).
          </p>
          <Button variant="secondary" size="sm" icon={showHidden ? EyeOff : Eye} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Gizlenenleri sakla" : "Gizlenenleri göster"}
          </Button>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <p className="text-sm text-text-muted">Tüm gruplar &quot;mükerrer değil&quot; olarak gizlendi.</p>
        </div>
      ) : (
        shown.map((g) => {
          const isHidden = hiddenSet.has(g.key);
          const best = Math.max(...g.records.map((r) => r.score));
          const panelId = `merge-p-${g.records[0]!.id}`;
          return (
            <section key={g.key} className={`surface-card rounded-[var(--radius-panel)] p-4 sm:p-5 ${isHidden ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5">
                    {g.reasons.map((r) => (
                      <Badge key={r} variant={g.strong ? "warning" : "info"}>
                        {r}
                      </Badge>
                    ))}
                  </p>
                  <p className="mt-1 text-xs text-text-faint">
                    {g.strong
                      ? "Aynı mahallede aynı işlem türü; büyük olasılıkla aynı mülk. Kat ve m² bilgisine bakın."
                      : "Başlık benzerliği tek başına kanıt değil; adres ve fotoğraflara bakın."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-text-muted">{g.records.length} ilan</span>
                  {isHidden ? (
                    <Button variant="secondary" size="sm" onClick={() => unhide(g.key)}>
                      Tekrar göster
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => hide(g.key)} title="Grubu bu cihazda gizle; veri silinmez">
                        Bu grup mükerrer değil
                      </Button>
                      {canMerge ? <MergeButton panelId={panelId} /> : null}
                    </>
                  )}
                </div>
              </div>

              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {g.records.map((r) => {
                  const suggested = r.score === best && best > 0;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/app/portfoyler/${r.id}`}
                        className={`lift-hover focus-ring group flex h-full items-start justify-between gap-3 rounded-[var(--radius-card)] border p-4 transition ${
                          suggested ? "border-mint-500/40 bg-mint-500/[0.05]" : "border-line bg-canvas"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="numeric text-xs font-semibold text-text-faint">{r.code}</p>
                          <p className="mt-0.5 line-clamp-2 font-semibold text-ink-950">{r.title}</p>
                          {r.address ? <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{r.address}</p> : null}
                          <p className="numeric mt-1 text-sm font-semibold text-ink-950">{r.price}</p>
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
                            <span>{r.status}</span>
                            {r.advisor ? <span>{r.advisor}</span> : null}
                            <span className="inline-flex items-center gap-1">
                              <Camera className="h-3.5 w-3.5" /> {r.mediaCount}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              {r.hasLocation ? <MapPin className="h-3.5 w-3.5" /> : <MapPinOff className="h-3.5 w-3.5" />}
                              {r.hasLocation ? "Konum var" : "Konum yok"}
                            </span>
                            <span>{r.created}</span>
                            {suggested ? <span className="font-semibold text-mint-600">en dolu kayıt</span> : null}
                          </p>
                        </div>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {canMerge && !isHidden ? (
                <MergePanel
                  panelId={panelId}
                  title="Portföy kayıtlarını birleştir"
                  adapter={ADAPTER}
                  records={g.records.map((r) => ({
                    id: r.id,
                    title: r.title,
                    subtitle: [r.code, r.address].filter(Boolean).join(" · "),
                    meta: `${r.price} · ${r.mediaCount} fotoğraf · ${r.hasLocation ? "konum var" : "konum yok"}`,
                    score: r.score,
                  }))}
                />
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
