"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, ScanSearch } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { analyzeListing } from "@/app/actions/listing-analysis";
import { formatDateTimeTr } from "@/lib/format";
import type { ListingAnalysisResult } from "@/lib/listing-analysis";

const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const pct = (v: number) => `${v > 0 ? "+" : ""}%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(v)}`;

export type StoredAnalysis = { result: ListingAnalysisResult; createdAt: string; unitsCharged: number };

const VERDICT_TONE: Record<ListingAnalysisResult["position"]["verdict"], string> = {
  "piyasa üstü": "text-amber-600",
  "piyasa seviyesinde": "text-mint-600",
  "piyasa altı": "text-brand-600",
};

type Notice = { tone: "info" | "warning" | "danger" | "success"; text: string };

/**
 * İlan analizi kartı (istemci kısmı): sonucu gösterir, "Analiz et" düğmesi action'ı çağırır. Kontör düşmez (yalnız
 * değerleme kontör harcar); aynı girdiyle 24 saat içinde kayıtlı sonuç gösterilir. Her sayı bir hedefe bağlıdır.
 */
export function ListingAnalysisPanel({
  propertyId,
  canRun,
  initial,
}: {
  propertyId: string;
  canRun: boolean;
  initial: StoredAnalysis | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [stored, setStored] = useState<StoredAnalysis | null>(initial);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fiyatHref = `/app/portfoyler/${propertyId}?sekme=fiyat`;
  const medyaHref = `/app/portfoyler/${propertyId}?sekme=medya`;

  function run() {
    setNotice(null);
    start(async () => {
      const res = await analyzeListing(propertyId);
      if (!res.ok) {
        setNotice({ tone: "danger", text: res.error });
        return;
      }
      const o = res.outcome;
      switch (o.status) {
        case "ok":
          setStored({ result: o.result, createdAt: o.createdAt, unitsCharged: o.unitsCharged });
          setNotice(
            o.cached
              ? { tone: "info", text: "Bu ilan için son 24 saatte aynı veriyle analiz yapılmıştı; kayıtlı sonuç gösteriliyor." }
              : { tone: "success", text: "Analiz hazır." },
          );
          router.refresh();
          break;
        case "no_comps":
          setNotice({ tone: "warning", text: o.message });
          break;
        case "disabled":
          setNotice({ tone: "info", text: o.message });
          break;
        case "not_found":
          setNotice({ tone: "danger", text: "Portföy bulunamadı." });
          break;
        case "error":
          setNotice({ tone: "danger", text: o.message });
          break;
      }
    });
  }

  const r = stored?.result ?? null;

  return (
    <Card id="ilan-analizi" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-brand-600" aria-hidden /> İlan analizi
          </CardTitle>
          <CardDescription>
            Emsal motoru ve (varsa) EmlakFiyati bölge verisiyle fiyat konumu. Kontör gerektirmez; aynı veriyle 24 saat içinde kayıtlı sonuç gösterilir.
          </CardDescription>
        </div>
        {canRun ? (
          <Button size="sm" onClick={run} loading={pending} disabled={pending} icon={ScanSearch}>
            {r ? "Yeniden analiz et" : "Analiz et"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <Alert tone={notice.tone}>{notice.text}</Alert>
        ) : null}

        {!r ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
            {canRun ? "Henüz analiz yapılmadı." : "Henüz analiz yapılmadı. Analiz için değerleme oluşturma yetkisi gerekir."}
          </p>
        ) : (
          <>
            <p className="text-xs text-text-faint">Son analiz: {formatDateTimeTr(stored!.createdAt)}. İlan fiyatı veya m² değişirse yeniden analiz edin.</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile href={fiyatHref} label="Fiyat konumu" value={pct(r.position.deviationPct)} sub={`${r.position.verdict} (emsal medyanına göre)`} valueClass={VERDICT_TONE[r.position.verdict]} />
              <Tile
                href={fiyatHref}
                label="m² fiyatı"
                value={r.listSqmPrice ? `${tl.format(r.listSqmPrice)}/m²` : "—"}
                sub={r.sqmGapPct != null && r.comps.medianSqmPrice ? `Emsal medyanı ${tl.format(r.comps.medianSqmPrice)}/m² (${pct(r.sqmGapPct)})` : "m² bilgisi yok"}
              />
              <Tile
                href={`/app/degerleme?property=${propertyId}`}
                label="Emsal"
                value={`${r.comps.count} kayıt`}
                sub={`Güven: ${r.comps.confidence} · ${r.comps.won} kapanış, ${r.comps.active} aktif ilan`}
              />
              <Tile
                href={fiyatHref}
                label="Bölgede yayında kalma"
                value={r.market.regionAvgDaysListed != null ? `${Math.round(r.market.regionAvgDaysListed)} gün` : "—"}
                sub={r.market.note ?? "Bölge verisi yok"}
              />
            </div>

            {r.efIndex ? (
              <p className="text-xs text-text-muted">
                EmlakFiyati {r.efIndex.ad} endeksi ({r.efIndex.donem.slice(0, 7)}, {r.efIndex.n} ilan): {tl.format(r.efIndex.medianM2)}/m²
                {r.efIndex.gapPct != null ? `; ilanınız ${pct(r.efIndex.gapPct)}` : ""}.
              </p>
            ) : null}

            {r.revision ? (
              <Alert tone="warning" title={`Fiyat revizyon önerisi (${r.revision.label})`}>
                {tl.format(r.revision.suggestedPrice)} (mevcut fiyatın %{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(r.revision.reducePct)} altı).
                {r.revision.ceilingPrice ? ` Üst bant: ${tl.format(r.revision.ceilingPrice)}.` : ""} {r.revision.note}
              </Alert>
            ) : r.revisionNote ? (
              <p className="text-xs text-text-muted">{r.revisionNote}</p>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-ink-950">İlan kalitesi kontrol listesi</h3>
              <ul className="mt-2 divide-y divide-line">
                {r.checklist.map((c) => (
                  <li key={c.id} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="mt-0.5 shrink-0" aria-hidden>
                      {c.status === "pass" ? <CheckCircle2 className="h-4 w-4 text-mint-600" /> : c.status === "warn" ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CircleDashed className="h-4 w-4 text-text-faint" />}
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold text-text">
                        {c.title}
                        <span className="sr-only"> — {c.status === "pass" ? "geçti" : c.status === "warn" ? "uyarı" : "isteğe bağlı"}</span>
                      </p>
                      <p className="text-xs text-text-muted">
                        {c.detail}
                        {c.status === "warn" && c.id === "photos" ? (
                          <>
                            {" "}
                            <Link href={medyaHref} className="font-medium text-brand-600 hover:underline">Medyaya git</Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ href, label, value, sub, valueClass }: { href: string; label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <Link href={href} className="focus-ring press block rounded-[var(--radius-card)] border border-line bg-canvas p-3 transition hover:border-brand-300">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`numeric mt-1 font-display text-lg font-extrabold text-ink-950 ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-text-faint">{sub}</p>
    </Link>
  );
}
