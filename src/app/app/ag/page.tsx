import { KpiGrid } from "@/components/ui/dashboard-grid";
import {
  Building2,
  Globe2,
  Handshake,
  Home,
  Inbox,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Ruler,
  Send,
  Share2,
  ShieldCheck,
  Trophy,
  User,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getProvinceOptions } from "@/lib/geo/reader";
import { getDefinitions } from "@/lib/definitions";
import { formatTry } from "@/lib/utils";
import { msSince, DAY_MS } from "@/lib/clock";
import {
  listMyDemandResponses,
  listMyLiveProperties,
  listMyNetworkDemands,
  listMyNetworkListings,
  listMyOpenDemands,
  listMyPropertiesForHint,
  listMyRequests,
  listNetworkDemandPool,
  listNetworkPool,
} from "@/app/actions/network/queries";
import type { NetworkContact } from "@/app/actions/network/shared";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ShareNetworkPanel, ShareNetworkTrigger } from "./share-network-panel";
import { CollabRequestDialog } from "./collab-request-dialog";
import { PoolFilters } from "./pool-filters";
import { MyListingActions, RespondButtons, WithdrawButton } from "./network-row-actions";
import { ShareDemandPanel, ShareDemandTrigger } from "./share-demand-panel";
import { DemandResponseDialog } from "./demand-response-dialog";
import { DemandRespondButtons, DemandWithdrawButton, MyDemandActions } from "./demand-row-actions";
import { AG_TABS, agTabHref, parseAgTab, parseSharedKind } from "./ag-tabs";
import { matchListingsForDemand, networkMatchScore } from "@/lib/network/match";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { FilterChip } from "@/components/ui/filter-chip";
import Link from "@/components/ui/smart-link";
import { Sparkles, X } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Ofisler Arası Ağ" };

const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

const REQUEST_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: "warning",
  accepted: "success",
  rejected: "danger",
  withdrawn: "default",
};

/** Maskeli bütçe aralığının kompakt gösterimi — "₺4,5–5,5M" (aralık zaten
 *  sunucuda 100K hassasiyetle yuvarlanmış gelir). */
function formatBudgetShort(v: number) {
  return Math.round(v).toLocaleString("tr-TR");
}

function formatBudgetRange(min: number | null, max: number | null) {
  if (min != null && max != null) return `₺${formatBudgetShort(min)}–${formatBudgetShort(max)}`;
  if (min != null) return `₺${formatBudgetShort(min)}+`;
  if (max != null) return `₺${formatBudgetShort(max)}'e kadar`;
  return "Bütçe belirtilmedi";
}

function demandSummary(d: {
  transactionType: string;
  propertyType: string | null;
  rooms: string | null;
  districtName: string | null;
  provinceName: string | null;
}) {
  return [
    d.districtName ?? d.provinceName,
    [d.transactionType, d.propertyType].filter(Boolean).join(" "),
    d.rooms,
  ]
    .filter(Boolean)
    .join(" · ");
}

function listingAge(sharedAt: string) {
  const days = Math.floor(msSince(sharedAt) / DAY_MS);
  if (days <= 0) return "Bugün paylaşıldı";
  if (days === 1) return "1 gün önce";
  return `${days} gün önce`;
}

function ContactCard({ contact }: { contact: NetworkContact }) {
  return (
    <div className="mt-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/6 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-mint-600">
        <ShieldCheck className="h-3.5 w-3.5" /> İletişim açıldı — {contact.officeName}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-950">
        {contact.personName ? (
          <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5 text-text-muted" /> {contact.personName}</span>
        ) : null}
        {contact.phone ? (
          <a className="focus-ring inline-flex items-center gap-1 font-medium" href={`tel:${contact.phone}`}>
            <Phone className="h-3.5 w-3.5 text-text-muted" /> {contact.phone}
          </a>
        ) : null}
        {contact.email ? (
          <a className="focus-ring inline-flex items-center gap-1 font-medium" href={`mailto:${contact.email}`}>
            <Mail className="h-3.5 w-3.5 text-text-muted" /> {contact.email}
          </a>
        ) : null}
        {!contact.personName && !contact.phone && !contact.email ? (
          <span className="text-text-muted">İletişim bilgisi bulunamadı.</span>
        ) : null}
      </div>
    </div>
  );
}

export default async function AgPage({
  searchParams,
}: {
  searchParams?: Promise<{
    sekme?: string; tur?: string; talep?: string;
    il?: string; tip?: string; min?: string; max?: string;
    // Talep havuzu filtreleri — bölüm bazlı `talep_` öneki (portföyle çakışmaz)
    talep_il?: string; talep_tip?: string; talep_min?: string; talep_max?: string;
  }>;
}) {
  const { perms } = await requireModulePage("network", "/app/ag");
  const networkPerms = perms.network ?? [];
  const canCreate = networkPerms.includes("create");
  const canEdit = networkPerms.includes("edit");

  const params = (await searchParams) ?? {};
  const il = (params.il ?? "").trim();
  const tip = (params.tip ?? "").trim();
  const minRaw = Number(params.min);
  const maxRaw = Number(params.max);
  const minPrice = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : undefined;
  const maxPrice = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;

  const talepIl = (params.talep_il ?? "").trim();
  const talepTip = (params.talep_tip ?? "").trim();
  const talepMinRaw = Number(params.talep_min);
  const talepMaxRaw = Number(params.talep_max);
  const minBudget = Number.isFinite(talepMinRaw) && talepMinRaw > 0 ? talepMinRaw : undefined;
  const maxBudget = Number.isFinite(talepMaxRaw) && talepMaxRaw > 0 ? talepMaxRaw : undefined;
  const hasDemandFilters = Boolean(talepIl || talepTip || minBudget || maxBudget);

  const tab = parseAgTab(params.sekme);
  const sharedKind = parseSharedKind(params.tur);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const talepId = tab === "havuz" && UUID.test(params.talep ?? "") ? params.talep! : "";
  const none = <T,>(v: T) => Promise.resolve(v);

  // OA11: her sekme yalnız kendi sorgusunu çalıştırır. "Benim" listeleri (4 küçük, kendi ofisim) sekme rozetleri için
  // her sekmede okunur; havuzlar ve diyalog kaynakları yalnız ilgili sekmede.
  const onPool = tab === "havuz";
  const onDemandPool = tab === "talep-havuzu";
  const onShared = tab === "paylastiklarim";
  const [
    pool,
    myListings,
    myRequests,
    provinces,
    propertyTypeDefs,
    liveProperties,
    demandPool,
    myDemands,
    myDemandResponses,
    myOpenDemands,
    hintProperties,
  ] = await Promise.all([
    // Talebe göre süzülünce (OA10) havuz süzgeçsiz okunur: eşleştirme tüm havuz üzerinde yapılır.
    onPool
      ? listNetworkPool(talepId ? {} : { provinceId: il || undefined, propertyType: tip || undefined, minPrice, maxPrice })
      : none([] as Awaited<ReturnType<typeof listNetworkPool>>),
    listMyNetworkListings(),
    listMyRequests(),
    onPool || onDemandPool ? getProvinceOptions() : none([] as Awaited<ReturnType<typeof getProvinceOptions>>),
    onPool || onDemandPool ? getDefinitions("property_type") : none([] as Awaited<ReturnType<typeof getDefinitions>>),
    canCreate && (onPool || onShared) ? listMyLiveProperties() : none([] as Awaited<ReturnType<typeof listMyLiveProperties>>),
    onDemandPool
      ? listNetworkDemandPool({ provinceId: talepIl || undefined, propertyType: talepTip || undefined, minBudget, maxBudget })
      : none([] as Awaited<ReturnType<typeof listNetworkDemandPool>>),
    listMyNetworkDemands(),
    listMyDemandResponses(),
    onPool || ((onDemandPool || onShared) && canCreate) ? listMyOpenDemands() : none([] as Awaited<ReturnType<typeof listMyOpenDemands>>),
    canCreate && onDemandPool ? listMyPropertiesForHint() : none([] as Awaited<ReturnType<typeof listMyPropertiesForHint>>),
  ]);

  const incomingPending = myListings.reduce(
    (total, l) => total + l.incoming.filter((r) => r.status === "pending").length,
    0,
  );
  const outgoingPending = myRequests.filter((r) => r.status === "pending").length;
  const demandIncomingPending = myDemands.reduce(
    (total, d) => total + d.incoming.filter((r) => r.status === "pending").length,
    0,
  );
  const demandOutgoingPending = myDemandResponses.filter((r) => r.status === "pending").length;
  const propertyTypes = propertyTypeDefs.length
    ? propertyTypeDefs.map((d) => d.value)
    : [...new Set(pool.map((p) => p.propertyType))];

  // ---- OA10: ağ eşleştirmesi — açık taleplerim ↔ diğer ofislerin havuz ilanları (maskeli alanlar) ----
  const foreignPool = pool.filter((p) => !p.isOwn);
  const demandMatches = onPool
    ? myOpenDemands
        .map((d) => ({ demand: d, matches: matchListingsForDemand(d.criteria, foreignPool) }))
        .filter((x) => x.matches.length > 0)
        .sort((a, b) => b.matches.length - a.matches.length)
    : [];
  const selectedDemand = talepId ? (myOpenDemands.find((d) => d.id === talepId) ?? null) : null;
  const shownPool = selectedDemand ? matchListingsForDemand(selectedDemand.criteria, foreignPool) : pool;

  // ---- Havuz istatistikleri — gerçek havuz verisinden türetilir ----
  const poolOffices = new Set(shownPool.map((p) => p.officeName)).size;
  const poolAvgShare = shownPool.length
    ? Math.round(shownPool.reduce((s, p) => s + p.commissionSharePct, 0) / shownPool.length)
    : 0;
  const pricedPool = shownPool.filter((p) => p.price != null);
  const poolVolume = pricedPool.reduce((s, p) => s + (p.price ?? 0), 0);
  const demandOffices = new Set(demandPool.map((d) => d.officeName)).size;
  const demandAvgShare = demandPool.length
    ? Math.round(demandPool.reduce((s, d) => s + d.commissionSharePct, 0) / demandPool.length)
    : 0;

  // Ters yön (OA10): talep havuzundaki dış talebe uyan kendi portföylerim; öneri diyaloğunda uyanlar üstte.
  const hintFor = (d: { transactionType: string; propertyType: string | null; rooms: string | null; provinceName: string | null; districtName: string | null; budgetMin: number | null; budgetMax: number | null }) => {
    const scored = hintProperties.map((p) => ({ p, s: networkMatchScore(d, p.criteria) }));
    const fit = scored.filter((x) => x.s !== null).sort((a, b) => (b.s ?? 0) - (a.s ?? 0)).map((x) => x.p);
    const rest = scored.filter((x) => x.s === null).map((x) => x.p);
    return {
      fitCount: fit.length,
      options: [...fit.map((p) => ({ ...p, hint: `Talebe uygun · ${p.hint}` })), ...rest].map(({ id, label, hint, maskedSummary }) => ({ id, label, hint, maskedSummary })),
    };
  };

  const tabCounts: Record<string, number | null> = {
    havuz: null,
    "talep-havuzu": null,
    paylastiklarim: incomingPending + demandIncomingPending || null,
    taleplerim: outgoingPending || null,
    onerilerim: demandOutgoingPending || null,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ağ"
        eyebrow="Ofisler arası ağ"
        description="Portföyünüzü diğer ofislerin talebine açın; komisyon paylaşımlı iş birliği kurun. Malik bilgisi ve açık adres asla görünmez, iletişim karşılıklı kabulden sonra açılır."
        actions={canCreate && (onPool || onShared) ? <ShareNetworkTrigger /> : undefined}
      />

      <KpiGrid>
        <StatCard label="Bekleyen gelen" value={incomingPending + demandIncomingPending} icon={Inbox} tone={incomingPending + demandIncomingPending > 0 ? "warning" : "neutral"} href={agTabHref("paylastiklarim", { tur: incomingPending === 0 && demandIncomingPending > 0 ? "talep" : null })} />
        <StatCard label="Gönderdiğim talep" value={outgoingPending} icon={Send} tone={outgoingPending > 0 ? "warning" : "neutral"} href={agTabHref("taleplerim")} />
        <StatCard label="Gönderdiğim öneri" value={demandOutgoingPending} icon={Home} tone={demandOutgoingPending > 0 ? "warning" : "neutral"} href={agTabHref("onerilerim")} />
        <StatCard label="Paylaştığım ilan" value={myListings.length} icon={Share2} href={agTabHref("paylastiklarim")} />
        <StatCard label="Paylaştığım talep" value={myDemands.length} icon={Megaphone} href={agTabHref("paylastiklarim", { tur: "talep" })} />
      </KpiGrid>

      <SegmentTabs
        label="Ağ sekmeleri"
        active={tab}
        items={AG_TABS.map((t) => ({ id: t.id, label: t.label, href: agTabHref(t.id), count: tabCounts[t.id] }))}
      />

      {canCreate && (onPool || onShared) ? <ShareNetworkPanel properties={liveProperties} /> : null}

      {/* ============ (a) İLAN HAVUZU ============ */}
      {onPool ? (
      <section id="havuz" aria-label="İlan havuzu" className="scroll-mt-24 space-y-4">
        {/* OA10: açık taleplerime uyan ağ ilanları — talep seçilince havuz ona göre süzülür. */}
        {selectedDemand ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand-400/40 bg-brand-600/6 px-4 py-3 text-sm">
            <Sparkles className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span className="min-w-0 flex-1 text-ink-950">
              <strong>{selectedDemand.label}</strong>
              {selectedDemand.hint ? <span className="text-text-muted"> · {selectedDemand.hint}</span> : null} talebinize uyan{" "}
              <strong className="numeric">{shownPool.length}</strong> ağ ilanı
            </span>
            <Link href={agTabHref("havuz")} className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs font-semibold text-brand-600 hover:underline">
              <X className="h-3.5 w-3.5" aria-hidden /> Tüm havuz
            </Link>
          </div>
        ) : talepId ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-3 text-sm text-text-muted">
            Bu talep artık açık değil ya da size ait değil.{" "}
            <Link href={agTabHref("havuz")} className="font-semibold text-brand-600 hover:underline">Tüm havuz</Link>
          </p>
        ) : demandMatches.length > 0 ? (
          <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
              <Sparkles className="h-4 w-4 text-brand-600" aria-hidden /> Taleplerinize uyan ağ ilanları
            </p>
            <div className="flex flex-wrap gap-2">
              {demandMatches.slice(0, 8).map(({ demand, matches }) => (
                <FilterChip key={demand.id} href={agTabHref("havuz", { talep: demand.id })} active={false}>
                  {demand.label}
                  {demand.hint ? ` · ${demand.hint}` : ""} · {matches.length} ilan
                </FilterChip>
              ))}
            </div>
          </div>
        ) : null}

        {/* Havuz nabzı — filtrelenmiş havuzun canlı istatistikleri */}
        {shownPool.length > 0 ? (
          <KpiGrid>
            {[
              { label: "Açık ilan", value: String(shownPool.length), icon: Globe2, tint: "bg-brand-600/10 text-brand-600" },
              { label: "Katılımcı ofis", value: String(poolOffices), icon: Building2, tint: "bg-mint-500/12 text-mint-600" },
              { label: "Ort. komisyon paylaşımı", value: `%${poolAvgShare}`, icon: Handshake, tint: "bg-amber-400/15 text-amber-600" },
              { label: "Havuz hacmi", value: poolVolume > 0 ? formatTry(poolVolume) : "—", icon: Trophy, tint: "bg-brand-600/10 text-brand-600" },
            ].map((s) => (
              <a
                key={s.label}
                href="#havuz"
                className="focus-ring press lift group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-300"
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] ${s.tint}`}>
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="numeric block truncate font-display text-lg font-extrabold text-ink-950">{s.value}</span>
                  <span className="block text-xs text-text-muted">{s.label}</span>
                </span>
              </a>
            ))}
          </KpiGrid>
        ) : null}

        {selectedDemand ? null : (
          <PoolFilters
            provinces={provinces}
            propertyTypes={propertyTypes}
            current={{ il, tip, min: params.min ?? "", max: params.max ?? "" }}
          />
        )}

        {shownPool.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Globe2}
            title={selectedDemand ? "Bu talebe uyan ağ ilanı yok" : "Havuzda ilan yok"}
            description={selectedDemand ? "Yeni bir ilan ağa açılıp talebinize uyduğunda size bildirim gelir." : "Seçili filtrelerde ağa açılmış ilan bulunamadı. Filtreleri genişletin ya da ilk paylaşımı siz yapın — paylaşan ofis, gelen her iş birliğinde komisyonun aslan payını korur."}
            tone="brand"
            action={canCreate ? { node: <ShareNetworkTrigger /> } : undefined}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownPool.map((item) => (
              <div key={item.listingId} className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                    <Building2 className="h-3.5 w-3.5" />
                    {item.officeName}
                    {item.officeCity ? <span className="text-text-faint">· {item.officeCity}</span> : null}
                  </span>
                  {item.isOwn ? <Badge variant="info" size="sm">Sizin</Badge> : null}
                </div>

                {/* Güven göstergesi — ofisin tamamlanmış işlem sayısı */}
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                  <Trophy className="h-3 w-3" /> {item.wonDeals} tamamlanmış işlem
                </p>

                <p className="mt-2 font-semibold text-ink-950">{item.title}</p>
                <p className="text-xs text-text-muted">
                  {[item.transactionType, item.propertyType, item.rooms].filter(Boolean).join(" · ")}
                </p>

                <div className="mt-2 space-y-1 text-xs text-text-muted">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {[item.districtName, item.provinceName].filter(Boolean).join(", ") || "Konum belirtilmedi"}
                  </p>
                  {item.sqm ? (
                    <p className="flex items-center gap-1.5">
                      <Ruler className="h-3.5 w-3.5" /> {item.sqm} m²
                    </p>
                  ) : null}
                </div>

                {item.note ? (
                  <p className="mt-2 rounded-[var(--radius-control)] bg-canvas p-2 text-xs text-text-muted">{item.note}</p>
                ) : null}

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-extrabold text-ink-950">
                      {item.price != null ? formatTry(item.price) : "Fiyat sorunuz"}
                    </p>
                    <p className="text-xs font-semibold text-mint-600">
                      %{item.commissionSharePct} komisyon paylaşımı
                    </p>
                  </div>
                  <p className="text-xs text-text-faint">{listingAge(item.sharedAt)}</p>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {item.isOwn ? (
                    <p className="text-xs text-text-faint">Kendi ilanınız; Paylaştıklarım sekmesinden yönetin.</p>
                  ) : item.myRequestStatus ? (
                    <Badge variant={REQUEST_STATUS_VARIANT[item.myRequestStatus]} size="sm">
                      Talebiniz: {REQUEST_STATUS_LABELS[item.myRequestStatus]}
                    </Badge>
                  ) : canCreate ? (
                    <CollabRequestDialog
                      listingId={item.listingId}
                      listingTitle={item.title}
                      officeName={item.officeName}
                    />
                  ) : (
                    <p className="text-xs text-text-faint">Talep göndermek için yetkiniz yok.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ (b) PAYLAŞTIKLARIM: ilanlar / talepler ============ */}
      {onShared ? (
        <nav aria-label="Paylaştıklarım türü" className="flex flex-wrap items-center gap-2">
          <FilterChip href={agTabHref("paylastiklarim")} active={sharedKind === "ilan"}>
            Paylaştığım ilanlar ({myListings.length})
          </FilterChip>
          <FilterChip href={agTabHref("paylastiklarim", { tur: "talep" })} active={sharedKind === "talep"}>
            Paylaştığım talepler ({myDemands.length})
          </FilterChip>
          {canCreate && sharedKind === "talep" ? <ShareDemandTrigger /> : null}
        </nav>
      ) : null}
      {onShared && sharedKind === "talep" && canCreate ? <ShareDemandPanel demands={myOpenDemands} /> : null}
      {onShared && sharedKind === "ilan" ? (
      <section id="paylastiklarim" aria-label="Paylaştığım ilanlar" className="scroll-mt-24 space-y-4">

        {myListings.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Share2}
            title="Henüz portföy paylaşmadınız"
            description="Yayındaki bir portföyünüzü komisyon paylaşım oranıyla ağa açın; diğer ofislerden iş birliği talepleri alın. Malik bilgisi ve açık adres her zaman maskeli kalır."
            tone="mint"
            action={canCreate ? { node: <ShareNetworkTrigger /> } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {myListings.map((listing) => (
              <div key={listing.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-950">
                        {listing.property?.title?.trim() || listing.property?.code || "Portföy silinmiş"}
                      </p>
                      <Badge variant={listing.status === "active" ? "success" : "warning"} size="sm">
                        {listing.status === "active" ? "Ağda aktif" : "Duraklatıldı"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      %{listing.commissionSharePct} komisyon paylaşımı · {listingAge(listing.createdAt)}
                      {listing.note ? ` · ${listing.note}` : ""}
                    </p>
                  </div>
                  {canEdit ? <MyListingActions id={listing.id} status={listing.status} /> : null}
                </div>

                {listing.incoming.length > 0 ? (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                      <Inbox className="h-3.5 w-3.5" /> Gelen talepler ({listing.incoming.length})
                    </p>
                    {listing.incoming.map((req) => (
                      <div key={req.id} className="rounded-[var(--radius-card)] bg-canvas p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-ink-950">
                                {req.fromOfficeName}
                                {req.fromOfficeCity ? (
                                  <span className="font-normal text-text-muted"> · {req.fromOfficeCity}</span>
                                ) : null}
                              </p>
                              <Badge variant={REQUEST_STATUS_VARIANT[req.status]} size="sm">
                                {REQUEST_STATUS_LABELS[req.status]}
                              </Badge>
                            </div>
                            {req.message ? (
                              <p className="mt-1 text-xs text-text-muted">“{req.message}”</p>
                            ) : null}
                          </div>
                          {req.status === "pending" && canEdit ? <RespondButtons requestId={req.id} /> : null}
                        </div>
                        {req.contact ? <ContactCard contact={req.contact} /> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ (c) TALEPLERİM (gönderdiğim iş birliği talepleri) ============ */}
      {tab === "taleplerim" ? (
      <section id="taleplerim" aria-label="Gönderdiğim iş birliği talepleri" className="scroll-mt-24 space-y-4">

        {myRequests.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Send}
            title="Henüz talep göndermediniz"
            description="Ağ havuzundan ilginizi çeken bir ilana iş birliği talebi gönderin; kabul edilince ofis iletişim bilgileri burada açılır."
            tone="brand"
            action={{ href: agTabHref("havuz"), label: "İlan havuzuna göz at" }}
          />
        ) : (
          <div className="space-y-3">
            {myRequests.map((req) => (
              <div key={req.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-950">{req.listing?.title ?? "İlan kaldırılmış"}</p>
                      <Badge variant={REQUEST_STATUS_VARIANT[req.status]} size="sm">
                        {REQUEST_STATUS_LABELS[req.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {req.toOfficeName}
                      {req.toOfficeCity ? ` · ${req.toOfficeCity}` : ""}
                      {req.listing
                        ? ` · ${[req.listing.districtName, req.listing.provinceName].filter(Boolean).join(", ")}`
                        : ""}
                      {req.listing?.price != null ? ` · ${formatTry(req.listing.price)}` : ""}
                      {req.listing ? ` · %${req.listing.commissionSharePct} paylaşım` : ""}
                    </p>
                    {req.message ? <p className="mt-1 text-xs text-text-muted">“{req.message}”</p> : null}
                  </div>
                  {req.status === "pending" && canEdit ? <WithdrawButton requestId={req.id} /> : null}
                </div>
                {req.contact ? <ContactCard contact={req.contact} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ (d) TALEP HAVUZU ============ */}
      {onDemandPool ? (
      <section id="talep-havuzu" aria-label="Talep havuzu" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">
            Diğer ofislerin alıcı talepleri: müşteri bilgisi maskeli, bütçe yuvarlanmış aralık.
          </p>
          {canCreate ? <ShareDemandTrigger /> : null}
        </div>
        {canCreate ? <ShareDemandPanel demands={myOpenDemands} /> : null}

        {/* Talep havuzu nabzı */}
        {demandPool.length > 0 ? (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Açık talep", value: String(demandPool.length), icon: Megaphone, tint: "bg-brand-600/10 text-brand-600" },
              { label: "Talep sahibi ofis", value: String(demandOffices), icon: Building2, tint: "bg-mint-500/12 text-mint-600" },
              { label: "Ort. komisyon paylaşımı", value: `%${demandAvgShare}`, icon: Handshake, tint: "bg-amber-400/15 text-amber-600" },
            ].map((s) => (
              <a
                key={s.label}
                href="#talep-havuzu"
                className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-300"
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] ${s.tint}`}>
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="numeric block truncate font-display text-lg font-extrabold text-ink-950">{s.value}</span>
                  <span className="block text-xs text-text-muted">{s.label}</span>
                </span>
              </a>
            ))}
          </div>
        ) : null}

        <PoolFilters
          provinces={provinces}
          propertyTypes={propertyTypes}
          current={{ il: talepIl, tip: talepTip, min: params.talep_min ?? "", max: params.talep_max ?? "" }}
          prefix="talep_"
          anchor="#talep-havuzu"
          typeLabel="Gayrimenkul tipi"
          minLabel="Min. bütçe (₺)"
          maxLabel="Maks. bütçe (₺)"
        />

        {demandPool.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Megaphone}
            title="Havuzda talep yok"
            description={
              hasDemandFilters
                ? "Seçili filtrelerde ağa açılmış alıcı talebi bulunamadı. Filtreleri genişletmeyi deneyin."
                : "Henüz ağa açılmış alıcı talebi bulunmuyor. Açık taleplerinizden birini paylaşarak diğer ofislerin portföylerini talebinize çekin."
            }
            action={canCreate ? { node: <ShareDemandTrigger /> } : undefined}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demandPool.map((item) => {
              const fit = hintFor(item);
              return (
              <div key={item.networkDemandId} className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                    <Building2 className="h-3.5 w-3.5" />
                    {item.officeName}
                    {item.officeCity ? <span className="text-text-faint">· {item.officeCity}</span> : null}
                  </span>
                  {item.isOwn ? <Badge variant="info" size="sm">Sizin</Badge> : null}
                </div>

                <p className="mt-2 font-semibold text-ink-950">{demandSummary(item) || "Alıcı talebi"}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                  <MapPin className="h-3.5 w-3.5" />
                  {[item.districtName, item.provinceName].filter(Boolean).join(", ") || "Konum belirtilmedi"}
                </p>

                {item.note ? (
                  <p className="mt-2 rounded-[var(--radius-control)] bg-canvas p-2 text-xs text-text-muted">{item.note}</p>
                ) : null}

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-extrabold text-ink-950">
                      {formatBudgetRange(item.budgetMin, item.budgetMax)}
                    </p>
                    <p className="text-xs font-semibold text-mint-600">
                      %{item.commissionSharePct} komisyon paylaşımı
                    </p>
                  </div>
                  <p className="text-xs text-text-faint">{listingAge(item.sharedAt)}</p>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {item.isOwn ? (
                    <p className="text-xs text-text-faint">Kendi talebiniz; Paylaştıklarım sekmesinden yönetin.</p>
                  ) : item.myResponseStatus ? (
                    <Badge variant={REQUEST_STATUS_VARIANT[item.myResponseStatus]} size="sm">
                      Öneriniz: {REQUEST_STATUS_LABELS[item.myResponseStatus]}
                    </Badge>
                  ) : canCreate ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {fit.fitCount > 0 ? (
                        <Badge variant="success" size="sm">
                          {fit.fitCount} uygun portföyünüz
                        </Badge>
                      ) : null}
                      <DemandResponseDialog
                        networkDemandId={item.networkDemandId}
                        demandSummary={demandSummary(item) || "Alıcı talebi"}
                        officeName={item.officeName}
                        properties={fit.options}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-text-faint">Öneri göndermek için yetkiniz yok.</p>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ (e) PAYLAŞTIĞIM TALEPLER ============ */}
      {onShared && sharedKind === "talep" ? (
      <section id="paylastigim-talepler" aria-label="Paylaştığım talepler" className="scroll-mt-24 space-y-4">

        {myDemands.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Megaphone}
            title="Henüz talep paylaşmadınız"
            description="Açık bir alıcı talebinizi komisyon paylaşım oranıyla ağa açın; diğer ofislerden portföy önerileri alın. Müşteri kimliği maskeli, bütçe yuvarlanmış aralık olarak görünür."
            tone="amber"
            action={canCreate ? { node: <ShareDemandTrigger /> } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {myDemands.map((nd) => (
              <div key={nd.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-950">
                        {nd.demand ? demandSummary({
                          transactionType: nd.demand.transactionType,
                          propertyType: nd.demand.propertyType,
                          rooms: nd.demand.rooms,
                          districtName: nd.demand.districtName,
                          provinceName: nd.demand.provinceName,
                        }) || "Alıcı talebi" : "Talep silinmiş"}
                      </p>
                      <Badge variant={nd.status === "active" ? "success" : "warning"} size="sm">
                        {nd.status === "active" ? "Ağda aktif" : "Duraklatıldı"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {nd.demand ? `${formatBudgetRange(nd.demand.budgetMin, nd.demand.budgetMax)} · ` : ""}
                      %{nd.commissionSharePct} komisyon paylaşımı · {listingAge(nd.createdAt)}
                      {nd.note ? ` · ${nd.note}` : ""}
                    </p>
                  </div>
                  {canEdit ? <MyDemandActions id={nd.id} status={nd.status} /> : null}
                </div>

                {nd.incoming.length > 0 ? (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                      <Inbox className="h-3.5 w-3.5" /> Gelen portföy önerileri ({nd.incoming.length})
                    </p>
                    {nd.incoming.map((resp) => (
                      <div key={resp.id} className="rounded-[var(--radius-card)] bg-canvas p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-ink-950">
                                {resp.fromOfficeName}
                                {resp.fromOfficeCity ? (
                                  <span className="font-normal text-text-muted"> · {resp.fromOfficeCity}</span>
                                ) : null}
                              </p>
                              <Badge variant={REQUEST_STATUS_VARIANT[resp.status]} size="sm">
                                {REQUEST_STATUS_LABELS[resp.status]}
                              </Badge>
                            </div>
                            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-950">
                              <Home className="h-3.5 w-3.5 text-text-muted" /> {resp.propertyHint}
                            </p>
                            {resp.message ? (
                              <p className="mt-1 text-xs text-text-muted">“{resp.message}”</p>
                            ) : null}
                          </div>
                          {resp.status === "pending" && canEdit ? <DemandRespondButtons responseId={resp.id} /> : null}
                        </div>
                        {resp.contact ? <ContactCard contact={resp.contact} /> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ (f) ÖNERİLERİM (talep havuzuna gönderdiğim portföy önerileri) ============ */}
      {tab === "onerilerim" ? (
      <section id="talep-yanitlarim" aria-label="Gönderdiğim portföy önerileri" className="scroll-mt-24 space-y-4">

        {myDemandResponses.length === 0 ? (
          <EmptyState illustration="ekip"
            icon={Home}
            title="Henüz portföy önerisi göndermediniz"
            description="Talep havuzundan uygun bir talebe portföy önerinizi gönderin; kabul edilince iletişim burada açılır."
            tone="mint"
            action={{ href: agTabHref("talep-havuzu"), label: "Talep havuzuna göz at" }}
          />
        ) : (
          <div className="space-y-3">
            {myDemandResponses.map((resp) => (
              <div key={resp.id} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-950">
                        {resp.demand ? demandSummary(resp.demand) || "Alıcı talebi" : "Talep kaldırılmış"}
                      </p>
                      <Badge variant={REQUEST_STATUS_VARIANT[resp.status]} size="sm">
                        {REQUEST_STATUS_LABELS[resp.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {resp.toOfficeName}
                      {resp.toOfficeCity ? ` · ${resp.toOfficeCity}` : ""}
                      {resp.demand ? ` · ${formatBudgetRange(resp.demand.budgetMin, resp.demand.budgetMax)}` : ""}
                      {resp.demand ? ` · %${resp.demand.commissionSharePct} paylaşım` : ""}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-950">
                      <Home className="h-3.5 w-3.5 text-text-muted" /> Önerim: {resp.propertyHint}
                    </p>
                    {resp.message ? <p className="mt-1 text-xs text-text-muted">“{resp.message}”</p> : null}
                  </div>
                  {resp.status === "pending" && canEdit ? <DemandWithdrawButton responseId={resp.id} /> : null}
                </div>
                {resp.contact ? <ContactCard contact={resp.contact} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}
