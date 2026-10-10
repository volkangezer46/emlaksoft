import Link from "@/components/ui/smart-link";
import { CheckCheck, Clock3, FileQuestion, GitMerge } from "lucide-react";
import { StatCard } from "@/components/app/stat-card";
import { formatTry } from "@/lib/format";
import { getControlSummary } from "@/lib/listing-control/server/readers";
import { EXTENSION_DOWNLOAD_PATH, EXTENSION_VERSION, extensionStoreEnv } from "@/lib/listing-control/worker/extension-release";
import { getExtensionPackageInfo } from "@/lib/listing-control/server/extension-package";
import { CONTROL_BASE, anomalyTypeLabel, kpiHref } from "./helpers";
import { getDb, loadPropertyBriefs } from "./readers";
import { listDiffs, listSuggestions, loadSyncOverview } from "./sync-readers";
import { QuickMatchActions } from "./quick-match-card";
import { SyncSetup } from "./sync-setup";
import { Panel, VisualChip } from "./ui-parts";

/**
 * GÜNLÜK İLAN KONTROLÜ (Özet'in üstü): durum şeridi + 3 adım, 4 tıklanabilir sayı, onay kartları, fark listesi.
 * Her sayı filtreli hedefe gider (sıfır çıkmaz metrik); veri yoksa kart uydurulmaz.
 */
export async function DailySyncSection({ canDecide, bind = false }: { canDecide: boolean; bind?: boolean }) {
  const db = await getDb();
  const [overview, summary, suggestions, diffs, pkg] = await Promise.all([
    loadSyncOverview(db),
    getControlSummary(db, "tenant"),
    canDecide ? listSuggestions(db, 4) : Promise.resolve([]),
    listDiffs(db, 8),
    getExtensionPackageInfo(),
  ]);
  const stores = extensionStoreEnv();
  const inPortals = summary.available ? summary.rows.reduce((s, r) => s + r.in_portals, 0) : 0;
  const awaiting = summary.available ? summary.rows.reduce((s, r) => s + r.awaiting_publish, 0) : 0;
  const pending = overview.suggested + overview.unsure;
  const briefs = await loadPropertyBriefs(db, [...suggestions.map((s) => s.property_id), ...diffs.map((d) => d.property_id)]);

  return (
    <section aria-label="Günlük eşleştirme" className="space-y-4">
      <SyncSetup
        latestVersion={EXTENSION_VERSION}
        chromeStoreUrl={stores.chrome}
        edgeStoreUrl={stores.edge}
        downloadHref={pkg ? EXTENSION_DOWNLOAD_PATH : null}
        extensionId={process.env.NEXT_PUBLIC_LISTING_EXTENSION_ID ?? null}
        lastServerScan={overview.lastImport ? { at: overview.lastImport.at, complete: overview.lastImport.complete, read: overview.lastImport.read } : null}
        bind={bind}
        summary={{
          found: overview.lastImport?.read ?? null,
          matched: inPortals,
          pending,
          links: {
            found: `${CONTROL_BASE}/envanter`,
            matched: kpiHref("in_portals"),
            pending: `${CONTROL_BASE}/eslesme?grup=${overview.suggested > 0 ? "onay" : "emin"}`,
          },
        }}
      />
      <nav aria-label="Günlük eşleştirme göstergeleri" className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Eşleşen ilan" value={inPortals} icon={CheckCheck} tone="success" href={kpiHref("in_portals")} />
        <StatCard label="Onay bekleyen" value={pending} icon={GitMerge} tone={pending > 0 ? "warn" : "neutral"} href={`${CONTROL_BASE}/eslesme?grup=${overview.suggested > 0 ? "onay" : "emin"}`} />
        <StatCard label="Yayında olmayan portföy" value={awaiting} icon={Clock3} tone={awaiting > 0 ? "warn" : "neutral"} href={kpiHref("awaiting_publish")} />
        <StatCard label="Portföyde olmayan ilan" value={overview.orphan} icon={FileQuestion} tone={overview.orphan > 0 ? "danger" : "neutral"} href={`${CONTROL_BASE}/eslesme?grup=yok`} />
      </nav>

      {suggestions.length > 0 ? (
        <Panel title="Eşleşme onayı" description="Portal ilanı ile portföyünüz aynı görünüyor mu? Tek tıkla karar verin." action={<Link href={`${CONTROL_BASE}/eslesme`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">Hepsini gör</Link>}>
          <ul className="divide-y divide-line">
            {suggestions.map((s) => {
              const b = briefs.get(s.property_id);
              const oneClick = s.top_score >= 85 && !s.ambiguous;
              return (
                <li key={s.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-text">
                      <span className="capitalize">{s.portal}</span> · {s.title ?? `İlan ${s.external_id}`}
                      {s.price !== null ? <span className="font-normal text-text-muted"> · {formatTry(s.price)}</span> : null}
                    </p>
                    <p className="text-text-muted">
                      <VisualChip visual={oneClick ? "healthy" : "pending"} label={oneClick ? `%${Math.round(s.top_score)} · Önerilen` : `%${Math.round(s.top_score)} · Emin değilim`} />{" "}
                      <Link href={`/app/portfoyler/${s.property_id}?sekme=portallar`} className="focus-ring rounded font-medium text-accent-text hover:underline">
                        {b ? `${b.code} ${b.title}` : "Portföy"}
                      </Link>
                    </p>
                  </div>
                  {oneClick ? <QuickMatchActions candidateId={s.id} propertyId={s.property_id} /> : <Link href={`${CONTROL_BASE}/eslesme?grup=emin`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">{s.ambiguous ? "Hangisi? İncele" : "İncele"}</Link>}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {diffs.length > 0 ? (
        <Panel title="Son farklar" description="Portal ile portföyünüz arasında dikkat isteyenler." action={<Link href={`${CONTROL_BASE}/anomaliler`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">Uyarı kuyruğu</Link>}>
          <ul className="divide-y divide-line text-sm">
            {diffs.map((d) => {
              const b = briefs.get(d.property_id);
              return (
                <li key={d.id}>
                  <Link href={`${CONTROL_BASE}/anomaliler?tur=${d.type}&portfoy=${d.property_id}`} className="focus-ring flex flex-wrap items-center justify-between gap-2 rounded px-1 py-2 hover:bg-surface-hover">
                    <span className="font-medium text-text">{anomalyTypeLabel(d.type)}</span>
                    <span className="text-text-muted">{b ? `${b.code} ${b.title}` : "Portföy"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </section>
  );
}
