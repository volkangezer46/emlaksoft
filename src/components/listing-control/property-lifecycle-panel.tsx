import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, CircleHelp, Link2 } from "lucide-react";
import { now } from "@/lib/clock";
import { formatDateTimeTr, formatDateTr, formatTry } from "@/lib/format";
import { buildChainStats } from "@/lib/listing-control/chain";
import { STAGE_LABELS, EXIT_LABELS, type ExitKind, type LifecycleStage } from "@/lib/listing-control/types";
import { Panel, VisualChip } from "./ui-parts";
import { CHECK_STATE_LABELS, checkStateVisual } from "./check-labels";
import { anomalyTypeLabel, durationLabel, type KpiVisual } from "./helpers";
import { tristateLabel, unionPublishedDays } from "./lifecycle-model";
import { getDb, loadLifecycle, type LifecycleData } from "./readers";
import { loadClosureChecklist } from "./closure-reader";
import { PortalBindForm } from "./portal-bind-form";
import { SkeletonCard } from "@/components/ui/viz";


/**
 * Portföy detayı: "Yaşam döngüsü & portal geçmişi". Tek izole bileşen; portföy detay sayfası yalnız bunu çağırır.
 * Sunucu bileşeni, kendi Suspense sınırında akar (ilk boyamayı geciktirmez; iskelet sabit yükseklik).
 */
export function PropertyLifecyclePanel({ propertyId, tenantId, canCreate }: { propertyId: string; tenantId: string | null; canCreate: boolean }) {
  return (
    <Suspense fallback={<SkeletonCard height={360} variant="card" label="Yaşam döngüsü yükleniyor" />}>
      <LifecycleBody propertyId={propertyId} tenantId={tenantId} canCreate={canCreate} />
    </Suspense>
  );
}

const SCORE_VISUAL: Record<string, KpiVisual> = { green: "healthy", yellow: "pending", orange: "mismatch", red: "critical", gray: "unverifiable" };
const SCORE_LABEL: Record<string, string> = { green: "Sağlıklı", yellow: "Kontrol bekliyor", orange: "Uyuşmazlık", red: "Kritik", gray: "Kontrol edilemiyor" };

async function LifecycleBody({ propertyId, tenantId, canCreate }: { propertyId: string; tenantId: string | null; canCreate: boolean }) {
  const db = await getDb();
  const nowMs = now();
  const data = await loadLifecycle(db, tenantId, propertyId, nowMs);
  if (!data.available) {
    return (
      <Panel title="Yaşam döngüsü & portal geçmişi">
        <p className="text-sm text-text-muted">Bu portföyün portal geçmişi şu an okunamadı.</p>
      </Panel>
    );
  }
  const chains = buildChainStats(
    data.listings.map((l) => ({ id: l.id, portal: l.portal, externalId: l.externalId, status: l.status, publishedAt: l.publishedAt, removedAt: l.removedAt, supersedesId: l.supersedesId })),
    nowMs,
  );
  const closed = data.stage === "sold" || data.stage === "rented" || data.stage === "exited";
  const closure = closed && data.exitKind
    ? await loadClosureChecklist(db, propertyId, data.exitKind as ExitKind, data.listings.length === 0 ? null : data.listings.some((l) => l.status === "live"))
    : null;
  const liveListings = data.listings.filter((l) => l.status === "live").map((l) => ({ id: l.id, portal: l.portal, externalId: l.externalId }));
  return (
    <div className="space-y-4">
      <Panel
        title="Yaşam döngüsü & portal geçmişi"
        description={data.stage ? `Şu anki aşama: ${STAGE_LABELS[data.stage as LifecycleStage] ?? data.stage}${data.exitKind ? ` (${EXIT_LABELS[data.exitKind as ExitKind] ?? data.exitKind})` : ""}` : "İlan kontrol kaydı henüz oluşmadı"}
        action={data.openAnomalies.length > 0 ? (
          <Link href={`/app/ilan-kontrol/anomaliler`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
            {data.openAnomalies.length} açık uyarı: {data.openAnomalies.slice(0, 2).map((a) => anomalyTypeLabel(a.type)).join(", ")}
          </Link>
        ) : null}
      >
        {!data.controlAvailable ? (
          <p className="mb-3 text-sm text-text-muted">İlan kontrol sistemi bu ofiste henüz etkin değil; yalnız portal ilan zinciri gösteriliyor.</p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <HealthScoreCard data={data} />
          <PortalChains chains={chains} total={unionPublishedDays(data.listings, nowMs)} />
        </div>
      </Panel>

      <Panel title="Portal fiyatları ve son kontrol" description="Emlaksoft fiyatı ile portallardaki fiyat yan yana">
        <PriceAndChecks data={data} />
      </Panel>

      <Panel title="Zaman çizelgesi" description="Portföyün baştan bugüne olayları (yeniden eskiye)">
        {data.timeline.length === 0 ? (
          <p className="text-sm text-text-muted">Henüz kayıtlı olay yok.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-5">
            {data.timeline.slice(0, 40).map((e, i) => (
              <li key={`${e.at}-${i}`} className="relative">
                <span aria-hidden="true" className="absolute -left-[1.62rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-500" />
                <p className="text-sm font-medium text-text">{e.title}</p>
                <p className="text-xs text-text-muted">{formatDateTimeTr(e.at)}{e.detail ? ` · ${e.detail}` : ""}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {closure ? (
        <Panel title="Kapanış kontrol listesi" description={`Tamamlanma %${closure.percent}${closure.unmeasured.length ? `; ${closure.unmeasured.length} madde ölçülemedi` : ""}`}>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {closure.items.filter((i) => i.required).map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                <span>{i.label}</span>
                <VisualChip visual={i.done === true ? "healthy" : i.done === false ? "critical" : "unverifiable"} label={tristateLabel(i.done)} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {canCreate ? (
        <Panel id="portal-bagla" title="Portal ilanı bağla" description="Yeni ilanı bağlayın ya da ilan numarası değiştiyse eski kaydı zincire ekleyin">
          <PortalBindForm propertyId={propertyId} liveListings={liveListings} />
        </Panel>
      ) : null}
    </div>
  );
}

function HealthScoreCard({ data }: { data: LifecycleData }) {
  const s = data.score;
  if (!s || s.score === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line p-4">
        <h3 className="text-sm font-semibold text-text">İlan sağlık skoru</h3>
        <p className="mt-2 flex items-center gap-2 text-sm text-text-muted"><CircleHelp aria-hidden="true" className="h-4 w-4" /> Ölçülemedi: hiçbir bileşen için veri yok.</p>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--radius-card)] border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">İlan sağlık skoru</h3>
        <VisualChip visual={SCORE_VISUAL[s.color] ?? "neutral"} label={SCORE_LABEL[s.color] ?? "Genel"} />
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-text">{s.score}<span className="text-sm font-medium text-text-muted">/100</span></p>
      {s.partial ? <p className="text-xs text-text-muted">Ölçülemeyen bileşenler hesaba katılmadı.</p> : null}
      {data.storedScore !== null && data.storedScore !== s.score ? <p className="text-xs text-text-muted">Son tarama kaydı: {data.storedScore}</p> : null}
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Sağlık skoru bileşenleri</caption>
        <thead>
          <tr className="text-left text-xs text-text-muted"><th scope="col" className="py-1 font-medium">Bileşen</th><th scope="col" className="py-1 text-right font-medium">Puan</th></tr>
        </thead>
        <tbody>
          {s.components.filter((c) => c.weight > 0).map((c) => (
            <tr key={c.key} className="border-t border-line">
              <td className="py-1.5">{c.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {c.value === null ? <span className="text-text-muted">Ölçülemedi</span> : <>{c.points} / {c.weight}</>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortalChains({ chains, total }: { chains: ReturnType<typeof buildChainStats>; total: ReturnType<typeof unionPublishedDays> }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line p-4">
      <h3 className="text-sm font-semibold text-text">Portal geçmişi</h3>
      {total ? (
        <p className="mt-1 text-sm text-text">
          Toplam yayın süresi: <span className="font-semibold tabular-nums">{durationLabel(total.days * 24)}</span>
          <span className="text-text-muted">
            {total.firstPublishedAt ? ` · ilk yayın ${formatDateTr(total.firstPublishedAt)}` : ""}
            {total.liveNow ? " · şu an yayında" : " · şu an yayında değil"}
          </span>
        </p>
      ) : null}
      {chains.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Bu portföy henüz hiçbir portala bağlanmadı.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {chains.map((c) => (
            <li key={c.portal} className="text-sm">
              <p className="font-medium text-text">{c.portal} <span className="font-normal text-text-muted">· toplam yayın süresi {durationLabel(c.totalPublishedDays * 24)}{c.idChanges > 0 ? ` · ${c.idChanges} ilan no değişimi` : ""}</span></p>
              <ol className="mt-1 space-y-1">
                {c.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-text-muted">
                    <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
                    <span className="font-mono text-text">{r.externalId ?? "no yok"}</span>
                    <span>{r.publishedAt ? formatDateTr(r.publishedAt) : "?"} – {r.removedAt ? formatDateTr(r.removedAt) : r.status === "live" ? "aktif" : "?"}</span>
                    {r.status === "superseded" ? <span className="text-xs">(değişti)</span> : null}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriceAndChecks({ data }: { data: LifecycleData }) {
  const rows = data.listings.filter((l) => l.status !== "superseded");
  if (rows.length === 0) return <p className="text-sm text-text-muted">Karşılaştırılacak portal ilanı yok.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Portal ilanlarının fiyat ve kontrol durumu</caption>
        <thead>
          <tr className="text-xs text-text-muted">
            <th scope="col" className="py-1.5 font-medium">Portal</th>
            <th scope="col" className="py-1.5 text-right font-medium">Fiyat</th>
            <th scope="col" className="py-1.5 font-medium">Durum</th>
            <th scope="col" className="py-1.5 font-medium">Son görülme</th>
            <th scope="col" className="py-1.5 font-medium">Son kontrol</th>
            <th scope="col" className="py-1.5 text-right font-medium">Güven</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line bg-canvas/50">
            <th scope="row" className="py-2 font-medium">Emlaksoft (CRM)</th>
            <td className="py-2 text-right tabular-nums">{data.listPrice !== null ? formatTry(data.listPrice) : "-"}</td>
            <td className="py-2" colSpan={4}><span className="text-text-muted">Kaynak fiyat</span></td>
          </tr>
          {rows.map((l) => {
            const h = data.health.get(l.id);
            const diff = h?.portal_price != null && data.listPrice ? ((h.portal_price - data.listPrice) / data.listPrice) * 100 : null;
            return (
              <tr key={l.id} className="border-t border-line">
                <th scope="row" className="py-2 font-medium">{l.portal}{l.externalId ? <span className="ml-1 font-mono text-xs text-text-muted">{l.externalId}</span> : null}</th>
                <td className="py-2 text-right tabular-nums">
                  {h?.portal_price != null ? (
                    <>{formatTry(h.portal_price)}{diff !== null && Math.abs(diff) >= 0.1 ? <span className="ml-1 text-xs text-amber-700">({diff > 0 ? "+" : ""}{diff.toFixed(1)}%)</span> : <CheckCircle2 aria-label="Uyumlu" className="ml-1 inline h-3.5 w-3.5 text-mint-700" />}</>
                  ) : <span className="text-text-muted">Ölçülemedi</span>}
                </td>
                <td className="py-2">{h ? <VisualChip visual={checkStateVisual(h.check_state)} label={CHECK_STATE_LABELS[h.check_state] ?? h.check_state} /> : <span className="text-text-muted">Kontrol kaydı yok</span>}</td>
                <td className="py-2">{h?.last_seen_at ? formatDateTimeTr(h.last_seen_at) : <span className="text-text-muted">-</span>}</td>
                <td className="py-2">{h?.last_check_at ? formatDateTimeTr(h.last_check_at) : <span className="text-text-muted">-</span>}</td>
                <td className="py-2 text-right tabular-nums">{h?.confidence != null ? `%${Math.round(h.confidence * 100)}` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
