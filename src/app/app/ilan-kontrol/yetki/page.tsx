import Link from "@/components/ui/smart-link";
import { FilterChip } from "@/components/ui/filter-chip";
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
import { AuthorityMatchPanel } from "@/components/listing-control/authority-match-panel";
import { EidsInboxSection } from "./eids-inbox";
import { loadAuthorityQueue, type AuthorityQueueItem } from "@/lib/eids/authority-queue";
import { loadLatestUndoable } from "@/lib/eids/load";
import { EIDS_EVENT_KIND_LABELS } from "@/lib/eids/event-labels";
import {
  AUTHORITY_QUEUE_FILTERS,
  AUTHORITY_QUEUE_LABELS,
  EIDS_EXEMPT_LABELS,
  EIDS_SOURCE_LABELS,
  EIDS_STATUS_LABELS,
  canSendReminder,
  isAuthorityQueueFilter,
  isEidsExemptReason,
  isEidsSource,
  type AuthorityQueueFilter,
  type EidsDisplayStatus,
} from "@/lib/eids/authority-status";

export const metadata = { title: "Yetki kuyruğu" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<EidsDisplayStatus, BadgeVariant> = {
  unknown: "outline",
  pending: "warning",
  approved: "success",
  expiring: "warning",
  expired: "danger",
  revoked: "danger",
  rejected: "danger",
  exempt: "info",
};

type Sekme = "kuyruk" | "eslestir" | "eposta";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function YetkiKuyrukPage({ searchParams }: { searchParams: SearchParams }) {
  const { perms, tenantId, role } = await requireModulePage("portals", "/app/ilan-kontrol");
  const canEdit = (perms.portals ?? []).includes("edit");
  const sp = await searchParams;
  const sekmeRaw = one(sp.sekme);
  // ?sekme=eposta: Bakanlık (EİDS) e-postaları (EP3). ?sekme=eslestir: ilan-yetki eşleştirme (EP2). Varsayılan: kuyruk.
  const sekme: Sekme = sekmeRaw === "eslestir" ? "eslestir" : sekmeRaw === "eposta" ? "eposta" : "kuyruk";
  const kovaRaw = one(sp.kova);
  const kova = isAuthorityQueueFilter(kovaRaw) ? kovaRaw : null;
  const page = Math.max(1, Math.floor(Number(one(sp.sayfa)) || 1));
  // Eşleştir sekmesine bildirimden (EP3 kuyruğu) ön doldurma: ?no=&tur=&bitis=&olay=&mesaj= (mesaj = bildirim kimliği)
  const prefill = {
    propertyNo: (one(sp.no) ?? "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 40),
    dealKind: one(sp.tur) === "rent" ? "rent" : one(sp.tur) === "sale" ? "sale" : "",
    validUntil: /^\d{4}-\d{2}-\d{2}$/.test(one(sp.bitis) ?? "") ? (one(sp.bitis) as string) : "",
    kind: one(sp.olay) === "revoke" ? ("revoke" as const) : ("grant" as const),
    inboundMessageId: /^[0-9a-fA-F-]{36}$/.test(one(sp.mesaj) ?? "") ? (one(sp.mesaj) as string) : "",
  };
  return (
    <>
      <PageHeader
        eyebrow="İlan Kontrol"
        title="Yetki kuyruğu"
        description="EİDS yetki durumu: onay bekleyen, bitecek, süresi dolmuş, iptal edilmiş, bilinmeyen ve e-postası görülmemiş portföyler; eşleşmeyen Bakanlık bildirimleri için Eşleştir sekmesi. Hatırlatma İYS iznine bağlıdır."
        breadcrumbs={[{ label: "İlan Kontrol", href: CONTROL_BASE }, { label: "Yetki kuyruğu" }]}
      />
      <ControlSubNav active="yetki" closures={effectiveCanAccessModule(perms, "leak")} />
      <nav aria-label="Yetki sekmeleri" className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip href={`${CONTROL_BASE}/yetki`} active={sekme === "kuyruk"}>Kuyruk</FilterChip>
        <FilterChip href={`${CONTROL_BASE}/yetki?sekme=eslestir`} active={sekme === "eslestir"}>Eşleştir</FilterChip>
        <FilterChip href={`${CONTROL_BASE}/yetki?sekme=eposta`} active={sekme === "eposta"}>Bakanlık e-postaları</FilterChip>
      </nav>
      {sekme === "eposta" ? (
        <Suspense fallback={<SkeletonCard height={320} label="Bakanlık e-postaları yükleniyor" />}>
          <EidsInboxSection tenantId={tenantId} role={role} canEdit={canEdit} />
        </Suspense>
      ) : sekme === "eslestir" ? (
        <Suspense fallback={<SkeletonCard height={320} label="Eşleştirme yükleniyor" />}>
          <MatchBody canEdit={canEdit} tenantId={tenantId} prefill={prefill} />
        </Suspense>
      ) : (
        <Suspense fallback={<SkeletonCard height={480} label="Yetki kuyruğu yükleniyor" />}>
          <QueueBody kova={kova} page={page} canEdit={canEdit} tenantId={tenantId} />
        </Suspense>
      )}
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

/** Aciliyet sırası: iptal → dolmuş → bitiyor (az kalan önce) → onay bekleyen → bilinmiyor → teyitsiz → belgesiz. */
function rank(i: AuthorityQueueItem): number {
  if (i.display === "revoked") return -2000;
  if (i.display === "expired") return -1000 + (i.term.daysLeft ?? 0);
  if (i.term.state === "expiring") return i.term.daysLeft ?? 0;
  if (i.buckets.includes("bekleyen")) return 100;
  if (i.buckets.includes("iptal")) return 110;
  if (i.buckets.includes("bilinmiyor")) return 150;
  if (i.buckets.includes("teyitsiz")) return 180;
  return 200;
}

async function QueueBody({ kova, page, canEdit, tenantId }: { kova: AuthorityQueueFilter | null; page: number; canEdit: boolean; tenantId: string | null | undefined }) {
  if (!tenantId) return <ControlUnavailable />;
  const supabase = await createClient();
  const res = await loadAuthorityQueue(supabase, tenantId);
  if (!res.available) return <ControlUnavailable />;

  const nowMs = now();
  // "teyitsiz" kovası yalnız defter sütunları okunabiliyorsa ölçülür; ölçülemeyen kova gösterilmez (sahte sıfır yok).
  const visibleFilters = AUTHORITY_QUEUE_FILTERS.filter((f) => res.ledger || f !== "teyitsiz");
  const filters = (
    <nav aria-label="Kuyruk türü" className="mb-4 flex flex-wrap gap-1.5">
      <FilterChip href={hrefFor(null)} active={kova === null} count={res.summary.total}>
        Tümü
      </FilterChip>
      {visibleFilters.map((f) => (
        <FilterChip key={f} href={hrefFor(f)} active={kova === f} count={res.summary.counts[f]}>
          {AUTHORITY_QUEUE_LABELS[f]}
        </FilterChip>
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
          description="Onay bekleyen, süresi yaklaşan, dolmuş, iptal edilmiş, durumu bilinmeyen ya da belgesi eksik portföy görünmüyor."
          secondary={kova ? { href: hrefFor(null), label: "Tüm kuyruğu göster" } : { href: CONTROL_BASE, label: "Genel görünüme dön" }}
        />
      </>
    );
  }
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  const rows = list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const undoable = res.ledger ? await loadLatestUndoable(supabase, tenantId, rows.map((r) => r.id)) : new Map();

  return (
    <div className="space-y-3">
      {filters}
      {res.truncated ? <p className="text-xs text-text-muted">İlk 2000 portföy taranır; kuyruk eksik olabilir.</p> : null}
      <p className="text-sm text-text-muted">{list.length} portföy{kova ? ` · ${AUTHORITY_QUEUE_LABELS[kova]}` : ""}</p>
      <ul className="space-y-2.5">
        {rows.map((i) => {
          const can = canSendReminder(i, nowMs);
          const undo = undoable.get(i.id) ?? null;
          return (
            <li key={i.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <Link href={`/app/portfoyler/${i.id}?sekme=belgeler`} className="focus-ring block truncate rounded font-semibold text-accent-text hover:underline">
                    <span className="font-mono text-xs text-text-muted">{i.property_code ?? "-"}</span> {i.title ?? "Portföy"}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[i.display]} size="sm">EİDS: {EIDS_STATUS_LABELS[i.display]}</Badge>
                    {isEidsExemptReason(i.eids_exempt_reason) ? <Badge variant="info" size="sm">{EIDS_EXEMPT_LABELS[i.eids_exempt_reason]}</Badge> : null}
                    {isEidsSource(i.authority_eids_source) ? <Badge variant="outline" size="sm">Kaynak: {EIDS_SOURCE_LABELS[i.authority_eids_source]}</Badge> : null}
                    {i.buckets.includes("teyitsiz") ? <Badge variant="outline" size="sm">E-posta/teyit görülmedi</Badge> : null}
                    {i.buckets.includes("belgesiz") ? <Badge variant="outline" size="sm">Belge no yok</Badge> : null}
                    {i.term.state === "missing" ? <Badge variant="outline" size="sm">Bitiş tarihi yok</Badge> : null}
                  </div>
                  <p className="text-sm text-text-muted">
                    {i.display === "revoked"
                      ? "Malik yetkiyi iptal etmiş; yeni yayın ve portal aktarımı durduruldu. Canlı ilanları kaldırın."
                      : (i.term.message ?? (i.authorization_end ? `Yetki bitişi: ${String(i.authorization_end).slice(0, 10)}` : "Yetki tarihi girilmemiş."))}
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
                    undoEventId: undo?.id ?? null,
                    undoLabel: undo ? `${EIDS_EVENT_KIND_LABELS[undo.kind] ?? undo.kind} (${formatDateTimeTr(undo.created_at)})` : null,
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

type InboundRow = {
  id: string;
  eids_property_no: string | null;
  deal_kind: string | null;
  parse_kind: string | null;
  grantor_masked: string | null;
  valid_until: string | null;
  match_status: string | null;
  auth_result: string | null;
  at: string | null;
};

const MATCH_QUEUE = ["queued", "candidate", "no_match"];

/**
 * Eşleşmeyi bekleyen Bakanlık bildirimleri (EP3 `eids_inbound_messages`; tablo yoksa liste gösterilmez) + elle eşleştirme.
 * Okuma oturumlu istemciyle (RLS); kiracı sınırı açık `.eq("tenant_id")`.
 */
async function MatchBody({
  canEdit,
  tenantId,
  prefill,
}: {
  canEdit: boolean;
  tenantId: string | null | undefined;
  prefill: { propertyNo: string; dealKind: string; validUntil: string; kind: "grant" | "revoke"; inboundMessageId: string };
}) {
  if (!tenantId) return <ControlUnavailable />;
  const supabase = await createClient();
  const { data, error } = await supabase.from("eids_inbound_messages").select("*").eq("tenant_id", tenantId).in("match_status", MATCH_QUEUE).limit(50);
  const inbound: InboundRow[] = error
    ? []
    : ((data ?? []) as Record<string, unknown>[])
        .map((r) => ({
          id: String(r.id),
          eids_property_no: (r.eids_property_no as string | null) ?? null,
          deal_kind: (r.deal_kind as string | null) ?? null,
          parse_kind: (r.parse_kind as string | null) ?? null,
          grantor_masked: (r.grantor_masked as string | null) ?? null,
          valid_until: (r.valid_until as string | null) ?? null,
          match_status: (r.match_status as string | null) ?? null,
          auth_result: (r.auth_result as string | null) ?? null,
          at: ((r.processed_at ?? r.created_at) as string | null) ?? null,
        }))
        .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="font-display text-base font-bold text-ink-950">Eşleşmeyi bekleyen bildirimler</h2>
        {error ? (
          <p className="text-sm text-text-muted">Bakanlık e-postası alımı henüz kurulmadı; bildirimleri aşağıdaki formla elle eşleştirebilirsiniz.</p>
        ) : inbound.length === 0 ? (
          <p className="text-sm text-text-muted">Eşleşmeyi bekleyen bildirim yok.</p>
        ) : (
          <ul className="space-y-2">
            {inbound.map((m) => {
              const q = new URLSearchParams({ sekme: "eslestir", mesaj: m.id });
              if (m.eids_property_no) q.set("no", m.eids_property_no);
              if (m.deal_kind === "sale" || m.deal_kind === "rent") q.set("tur", m.deal_kind);
              if (m.valid_until) q.set("bitis", String(m.valid_until).slice(0, 10));
              if (m.parse_kind === "revoke") q.set("olay", "revoke");
              return (
                <li key={m.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Badge size="sm" variant={m.parse_kind === "revoke" ? "danger" : "info"}>{m.parse_kind === "revoke" ? "İptal" : "Yetki"}</Badge>
                    <span className="font-mono text-xs text-ink-950">{m.eids_property_no ?? "no yok"}</span>
                    {m.grantor_masked ? <span className="text-xs text-text-muted">Malik: {m.grantor_masked}</span> : null}
                    {m.valid_until ? <span className="text-xs text-text-muted">Bitiş: {String(m.valid_until).slice(0, 10)}</span> : null}
                    {m.auth_result === "unverified" ? <Badge size="sm" variant="warning">Doğrulanamadı</Badge> : null}
                    {m.at ? <span className="text-xs text-text-faint">{formatDateTimeTr(m.at)}</span> : null}
                  </div>
                  <Link href={`${CONTROL_BASE}/yetki?${q.toString()}`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
                    Eşleştir →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-base font-bold text-ink-950">Bildirimi elle eşleştir</h2>
        <p className="text-sm text-text-muted">
          Taşınmaz no birebir tutarsa tek portföy önerilir. Tutmazsa malik adı benzerliğine göre en çok 5 aday listelenir; hiçbir portföy kendiliğinden bağlanmaz.
        </p>
        <AuthorityMatchPanel key={`${prefill.propertyNo}-${prefill.kind}-${prefill.validUntil}-${prefill.inboundMessageId}`} canEdit={canEdit} prefill={prefill} />
      </section>
    </div>
  );
}
