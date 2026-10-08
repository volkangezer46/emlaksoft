import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonCard } from "@/components/ui/viz";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CONTROL_BASE } from "@/components/listing-control/helpers";
import { ControlSubNav } from "@/components/listing-control/sub-nav";
import { ControlUnavailable } from "@/components/listing-control/ui-parts";
import { AuthorityRowActions } from "@/components/listing-control/authority-row-actions";
import { loadAuthorityQueue, type AuthorityQueueItem } from "@/lib/eids/authority-queue";
import {
  AUTHORITY_QUEUE_FILTERS,
  AUTHORITY_QUEUE_LABELS,
  EIDS_STATUS_LABELS,
  canSendReminder,
  isAuthorityQueueFilter,
  type AuthorityQueueFilter,
  type EidsDisplayStatus,
} from "@/lib/eids/authority-status";

export const metadata = { title: "Yetki kuyruğu" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<EidsDisplayStatus, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  expired: "danger",
};

export default async function YetkiKuyrukPage({ searchParams }: { searchParams: SearchParams }) {
  const { perms, tenantId } = await requireModulePage("portals", "/app/ilan-kontrol");
  const canEdit = (perms.portals ?? []).includes("edit");
  const sp = await searchParams;
  const kovaRaw = Array.isArray(sp.kova) ? sp.kova[0] : sp.kova;
  const kova = isAuthorityQueueFilter(kovaRaw) ? kovaRaw : null;
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.sayfa) ? sp.sayfa[0] : sp.sayfa) || 1));
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Yetki kuyruğu"
        description="Mal sahibinin e-Devlet EİDS yetki onayı bekleyen, 15 gün içinde bitecek, süresi dolmuş ve belgesi eksik portföyler. Hatırlatma İYS iznine bağlıdır."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Yetki kuyruğu" }]}
      />
      <ControlSubNav active="yetki" closures={effectiveCanAccessModule(perms, "leak")} />
      <Suspense fallback={<SkeletonCard height={480} label="Yetki kuyruğu yükleniyor" />}>
        <QueueBody kova={kova} page={page} canEdit={canEdit} tenantId={tenantId} />
      </Suspense>
    </>
  );
}

function hrefFor(kova: AuthorityQueueFilter | null, page = 1) {
  const q = new URLSearchParams();
  if (kova) q.set("kova", kova);
  if (page > 1) q.set("sayfa", String(page));
  const s = q.toString();
  return `${CONTROL_BASE}/yetki${s ? `?${s}` : ""}`;
}

/** Aciliyet sırası: dolmuş → bitiyor (az kalan önce) → onay bekleyen → belgesiz. */
function rank(i: AuthorityQueueItem): number {
  if (i.term.state === "expired") return -1000 + (i.term.daysLeft ?? 0);
  if (i.term.state === "expiring") return i.term.daysLeft ?? 0;
  if (i.buckets.includes("bekleyen")) return 100;
  return 200;
}

async function QueueBody({ kova, page, canEdit, tenantId }: { kova: AuthorityQueueFilter | null; page: number; canEdit: boolean; tenantId: string | null | undefined }) {
  if (!tenantId) return <ControlUnavailable />;
  const supabase = await createClient();
  const res = await loadAuthorityQueue(supabase, tenantId);
  if (!res.available) return <ControlUnavailable />;

  const nowMs = now();
  const chip = (on: boolean) =>
    `focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${on ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-text hover:border-brand-400"}`;
  const filters = (
    <nav aria-label="Kuyruk türü" className="mb-4 flex flex-wrap gap-1.5">
      <Link href={hrefFor(null)} aria-current={kova === null ? "page" : undefined} className={chip(kova === null)}>
        Tümü <span className="tabular-nums">{res.summary.total}</span>
      </Link>
      {AUTHORITY_QUEUE_FILTERS.map((f) => (
        <Link key={f} href={hrefFor(f)} aria-current={kova === f ? "page" : undefined} className={chip(kova === f)}>
          {AUTHORITY_QUEUE_LABELS[f]} <span className="tabular-nums">{res.summary.counts[f]}</span>
        </Link>
      ))}
    </nav>
  );

  const list = res.items.filter((i) => (kova ? i.buckets.includes(kova) : true)).sort((a, b) => rank(a) - rank(b));
  if (list.length === 0) {
    return (
      <>
        {filters}
        <EmptyState
          icon={ShieldCheck}
          variant="panel"
          title={kova ? "Bu kovada portföy yok" : "Yetki kuyruğu boş"}
          description="Onay bekleyen, süresi yaklaşan, dolmuş ya da belgesi eksik portföy görünmüyor."
          secondary={kova ? { href: hrefFor(null), label: "Tüm kuyruğu göster" } : { href: CONTROL_BASE, label: "Genel görünüme dön" }}
        />
      </>
    );
  }
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  const rows = list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  return (
    <div className="space-y-3">
      {filters}
      {res.truncated ? <p className="text-xs text-text-muted">İlk 2000 portföy taranır; kuyruk eksik olabilir.</p> : null}
      <p className="text-sm text-text-muted">{list.length} portföy{kova ? ` · ${AUTHORITY_QUEUE_LABELS[kova]}` : ""}</p>
      <ul className="space-y-2.5">
        {rows.map((i) => {
          const can = canSendReminder(i, nowMs);
          return (
            <li key={i.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <Link href={`/app/portfoyler/${i.id}`} className="focus-ring block truncate rounded font-semibold text-accent-text hover:underline">
                    <span className="font-mono text-xs text-text-muted">{i.property_code ?? "-"}</span> {i.title ?? "Portföy"}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[i.display]} size="sm">EİDS: {EIDS_STATUS_LABELS[i.display]}</Badge>
                    {i.buckets.includes("belgesiz") ? <Badge variant="outline" size="sm">Belge no yok</Badge> : null}
                    {i.term.state === "missing" ? <Badge variant="outline" size="sm">Bitiş tarihi yok</Badge> : null}
                  </div>
                  <p className="text-sm text-text-muted">
                    {i.term.message ?? (i.authorization_end ? `Yetki bitişi: ${String(i.authorization_end).slice(0, 10)}` : "Yetki tarihi girilmemiş.")}
                  </p>
                  <p className="text-xs text-text-muted">
                    Mal sahibi: {i.owner ? i.owner.name : "kayıtlı değil"}
                    {i.owner && !i.owner.hasPhone ? " (telefon yok)" : ""}
                    {i.authority_reminder_sent_at
                      ? ` · Son hatırlatma: ${formatDateTimeTr(i.authority_reminder_sent_at)} (${i.authority_reminder_count ?? 1} kez)`
                      : " · Henüz hatırlatma gönderilmedi"}
                  </p>
                </div>
                <AuthorityRowActions
                  canEdit={canEdit}
                  row={{
                    propertyId: i.id,
                    docNo: i.authority_doc_no ?? "",
                    status: i.display,
                    hasOwnerPhone: Boolean(i.owner?.hasPhone),
                    canRemind: can.ok,
                    remindBlockedReason: can.reason,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label="Sayfalama" className="flex items-center justify-between text-sm">
          {cur > 1 ? <Link href={hrefFor(kova, cur - 1)} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">← Önceki</Link> : <span />}
          <span className="text-text-muted">Sayfa {cur} / {totalPages}</span>
          {cur < totalPages ? <Link href={hrefFor(kova, cur + 1)} className="focus-ring rounded px-2 py-1 font-semibold text-accent-text hover:underline">Sonraki →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
