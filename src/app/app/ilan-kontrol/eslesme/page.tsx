import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { GitMerge } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveCanAccessModule, effectiveHasPermission } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr, formatTry } from "@/lib/format";
import { getHtmlAdapter } from "@/lib/listing-control/adapters/html";
import { CONTROL_BASE } from "@/components/listing-control/helpers";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { VisualChip } from "@/components/listing-control/ui-parts";
import { MatchActions } from "@/components/listing-control/match-actions";
import { listMatchCandidates } from "@/components/listing-control/ops-readers";
import { getDb, loadPropertyBriefs } from "@/components/listing-control/readers";

export const metadata = { title: "İlan eşleşme kuyruğu" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 20;
const MANAGER_ROLES = new Set(["owner", "gm", "branch_manager"]);

/**
 * EŞLEŞME KUYRUĞU: portal listesinde görülüp CRM'de kaydı olmayan ilanlar. Her aday için `scoreMatch` güven yüzdesi ve
 * hangi sinyallerden oluştuğu gösterilir; yönetici Onayla (portföye bağla) / Reddet / Başka portföy seç kararı verir.
 * Aday portföy bulunamayan ilan "eşleşen portföy yok" olarak kalır: CRM'e hiç girilmemiş olabilir (kaçak riski).
 */
export default async function EslesmePage({ searchParams }: { searchParams: SearchParams }) {
  const { perms, role } = await requireModulePage("portals", "/app/ilan-kontrol");
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa) || 1));
  const canDecide = MANAGER_ROLES.has(role ?? "") && effectiveHasPermission(perms, "portals", "edit");
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Portalda olup CRM'de kaydı olmayan ilanlar"
        description="Portal listesinde görülen her kayıtsız ilan için en olası portföy ve güven yüzdesi. Onaylanan ilan portföye bağlanır ve kontrol edilmeye başlanır."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Eşleşme" }]}
      />
      <ControlSubNav active="eslesme" closures={effectiveCanAccessModule(perms, "leak")} />
      {MANAGER_ROLES.has(role ?? "") ? (
        <Suspense fallback={<SkeletonCard height={420} label="Eşleşme adayları yükleniyor" />}>
          <QueueBody page={page} canDecide={canDecide} />
        </Suspense>
      ) : (
        <EmptyState
          icon={GitMerge}
          variant="panel"
          title="Eşleşme kuyruğu yönetim kademesine açıktır"
          description="Ofis genelindeki kayıtsız ilanları ofis sahibi, genel müdür ve şube müdürü eşleştirir. Kendi portföyünüzdeki kayıtsız ilan uyarısını portföyün Portallar sekmesinden bağlayabilirsiniz."
          secondary={{ href: `${CONTROL_BASE}/anomaliler?tur=unregistered_listing`, label: "Kayıtsız ilan uyarılarım" }}
        />
      )}
    </>
  );
}

async function QueueBody({ page, canDecide }: { page: number; canDecide: boolean }) {
  const db = await getDb();
  const res = await listMatchCandidates(db, page, PAGE_SIZE);
  if (!res.available) {
    return (
      <EmptyState
        icon={GitMerge}
        variant="panel"
        title="Eşleşme kuyruğu bu ofiste henüz etkin değil"
        description="Sistem güncellemesi uygulandığında portal listesi karşılaştırmasından gelen kayıtsız ilanlar burada görünür. Şu an gösterilecek gerçek veri yok."
        secondary={{ href: `${CONTROL_BASE}/envanter`, label: "Portal listesiyle karşılaştır" }}
      />
    );
  }
  if (res.rows.length === 0) {
    return (
      <EmptyState
        icon={GitMerge}
        variant="panel"
        illustration="basari"
        title="Eşleşme bekleyen ilan yok"
        description="Portal listenizi karşılaştırdığınızda CRM'de kaydı olmayan ilanlar burada çıkar."
        secondary={{ href: `${CONTROL_BASE}/envanter`, label: "Portal listesiyle karşılaştır" }}
      />
    );
  }
  const briefs = await loadPropertyBriefs(db, res.rows.flatMap((r) => r.candidates.map((c) => c.property_id)));
  const totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{res.total} kayıtsız ilan</p>
      <ul className="space-y-2.5">
        {res.rows.map((r) => {
          const adapter = getHtmlAdapter(r.portal);
          const safeUrl = r.url && adapter?.isPortalUrl(r.url) ? r.url : null;
          const options = r.candidates
            .filter((c) => briefs.has(c.property_id))
            .map((c) => {
              const b = briefs.get(c.property_id);
              return { propertyId: c.property_id, label: `%${Math.round(c.score)} · ${b?.code ?? "-"} ${b?.title ?? ""}`.trim() };
            });
          return (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <p className="font-semibold text-text">
                    <span className="capitalize">{r.portal}</span> · ilan no <span className="font-mono">{r.external_id}</span>
                    {safeUrl ? (
                      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="focus-ring ml-2 rounded text-sm font-semibold text-accent-text hover:underline">
                        İlanı aç
                      </a>
                    ) : null}
                  </p>
                  <p className="text-sm text-text-muted">
                    {r.title ?? "Başlık yok"}
                    {r.price !== null ? ` · ${formatTry(r.price)}` : ""} · son görülme {formatDateTimeTr(r.last_seen_at)}
                  </p>
                  {r.candidates.length === 0 ? (
                    <VisualChip visual="critical" label="Eşleşen portföy yok: CRM'e girilmemiş olabilir" />
                  ) : (
                    <ul className="space-y-1">
                      {r.candidates.map((c) => {
                        const b = briefs.get(c.property_id);
                        return (
                          <li key={c.property_id} className="text-sm">
                            <VisualChip visual={c.score >= 85 ? "healthy" : c.score >= 60 ? "pending" : "unverifiable"} label={`%${Math.round(c.score)} güven`} />{" "}
                            <Link href={`/app/portfoyler/${c.property_id}?sekme=portallar`} className="focus-ring rounded font-medium text-accent-text hover:underline">
                              <span className="font-mono text-xs text-text-muted">{b?.code ?? "-"}</span> {b?.title ?? "Portföy"}
                            </Link>
                            {c.signals?.length ? (
                              <span className="text-xs text-text-muted"> · {c.signals.filter((s) => s.points > 0).map((s) => s.label).join(", ")}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {canDecide ? <MatchActions candidateId={r.id} options={options} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label="Sayfalama" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={`${CONTROL_BASE}/eslesme?sayfa=${page - 1}`} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">← Önceki</Link> : <span />}
          <span className="text-text-muted">Sayfa {page} / {totalPages}</span>
          {page < totalPages ? <Link href={`${CONTROL_BASE}/eslesme?sayfa=${page + 1}`} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">Sonraki →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
