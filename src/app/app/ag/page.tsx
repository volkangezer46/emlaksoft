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
import { getProvincesCached } from "@/lib/geo";
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
  type NetworkContact,
} from "@/app/actions/network";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ShareNetworkDialog } from "./share-network-dialog";
import { CollabRequestDialog } from "./collab-request-dialog";
import { PoolFilters } from "./pool-filters";
import { MyListingActions, RespondButtons, WithdrawButton } from "./network-row-actions";
import { ShareDemandDialog } from "./share-demand-dialog";
import { DemandResponseDialog } from "./demand-response-dialog";
import { DemandRespondButtons, DemandWithdrawButton, MyDemandActions } from "./demand-row-actions";

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
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000).toLocaleString("tr-TR")}K`;
  return v.toLocaleString("tr-TR");
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
    <div className="mt-2 rounded-[12px] border border-mint-500/30 bg-mint-500/6 p-3">
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
    il?: string; tip?: string; min?: string; max?: string;
    // Talep havuzu filtreleri — bölüm bazlı `talep_` öneki (portföyle çakışmaz)
    talep_il?: string; talep_tip?: string; talep_min?: string; talep_max?: string;
  }>;
}) {
  const { perms } = await requireModulePage("network");
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
    listNetworkPool({ provinceId: il || undefined, propertyType: tip || undefined, minPrice, maxPrice }),
    listMyNetworkListings(),
    listMyRequests(),
    getProvincesCached(),
    getDefinitions("property_type"),
    canCreate ? listMyLiveProperties() : Promise.resolve([]),
    listNetworkDemandPool({ provinceId: talepIl || undefined, propertyType: talepTip || undefined, minBudget, maxBudget }),
    listMyNetworkDemands(),
    listMyDemandResponses(),
    canCreate ? listMyOpenDemands() : Promise.resolve([]),
    canCreate ? listMyPropertiesForHint() : Promise.resolve([]),
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

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Globe2 className="h-4 w-4" /> Ofisler arası ağ
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Ağ</h1>
            <p className="mt-1 text-sm text-white/75">
              Portföyünüzü diğer ofislerin talebine açın; komisyon paylaşımlı iş birliği kurun.
            </p>
          </div>
          {canCreate ? <ShareNetworkDialog properties={liveProperties} /> : null}
        </div>
      </section>

      {/* Güven metni — ağın veri sözleşmesi */}
      <div className="flex items-start gap-3 rounded-[16px] border border-brand-600/20 bg-brand-600/6 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand-600/10 text-brand-600">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink-950">Ağ nasıl çalışır?</p>
          <p className="mt-0.5 text-text-muted">
            Verileriniz maskeli paylaşılır; malik bilgisi ve açık adres asla görünmez (konum ilçe
            düzeyindedir). İletişim bilgileri yalnız karşılıklı kabul sonrası açılır.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Havuzdaki ilan" value={pool.length} icon={Globe2} href="#havuz" />
        <StatCard label="Paylaştıklarım" value={myListings.length} icon={Share2} href="#paylastiklarim" />
        <StatCard
          label="Bekleyen talep"
          value={incomingPending + outgoingPending}
          icon={Handshake}
          tone={incomingPending + outgoingPending > 0 ? "warning" : "neutral"}
          href={incomingPending > 0 ? "#paylastiklarim" : "#taleplerim"}
        />
        <StatCard label="Havuzdaki talep" value={demandPool.length} icon={Megaphone} href="#talep-havuzu" />
        <StatCard
          label="Bekleyen öneri"
          value={demandIncomingPending + demandOutgoingPending}
          icon={Home}
          tone={demandIncomingPending + demandOutgoingPending > 0 ? "warning" : "neutral"}
          href={demandIncomingPending > 0 ? "#paylastigim-talepler" : "#talep-yanitlarim"}
        />
      </div>

      {/* ============ (a) AĞ HAVUZU ============ */}
      <section id="havuz" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Ağ havuzu</h2>
        <PoolFilters
          provinces={provinces}
          propertyTypes={propertyTypes}
          current={{ il, tip, min: params.min ?? "", max: params.max ?? "" }}
        />

        {pool.length === 0 ? (
          <EmptyState
            icon={Globe2}
            title="Havuzda ilan yok"
            description="Seçili filtrelerde ağa açılmış ilan bulunamadı. Filtreleri genişletin ya da ilk paylaşımı siz yapın."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pool.map((item) => (
              <div key={item.listingId} className="flex flex-col rounded-[20px] border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                    <Building2 className="h-3.5 w-3.5" />
                    {item.officeName}
                    {item.officeCity ? <span className="text-text-faint">· {item.officeCity}</span> : null}
                  </span>
                  {item.isOwn ? <Badge variant="info" size="sm">Sizin</Badge> : null}
                </div>

                {/* Güven göstergesi — ofisin tamamlanmış işlem sayısı */}
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
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
                  <p className="mt-2 rounded-[10px] bg-canvas p-2 text-xs text-text-muted">{item.note}</p>
                ) : null}

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-extrabold text-ink-950">
                      {item.price != null ? formatTry(item.price) : "Fiyat sorunuz"}
                    </p>
                    <p className="text-[11px] font-semibold text-mint-600">
                      %{item.commissionSharePct} komisyon paylaşımı
                    </p>
                  </div>
                  <p className="text-[11px] text-text-faint">{listingAge(item.sharedAt)}</p>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {item.isOwn ? (
                    <p className="text-xs text-text-faint">Kendi ilanınız — Paylaştıklarım bölümünden yönetin.</p>
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

      {/* ============ (b) PAYLAŞTIKLARIM ============ */}
      <section id="paylastiklarim" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Paylaştıklarım</h2>

        {myListings.length === 0 ? (
          <EmptyState
            icon={Share2}
            title="Henüz portföy paylaşmadınız"
            description="Yayındaki bir portföyünüzü komisyon paylaşım oranıyla ağa açın; diğer ofislerden iş birliği talepleri alın."
            action={canCreate ? { node: <ShareNetworkDialog properties={liveProperties} /> } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {myListings.map((listing) => (
              <div key={listing.id} className="rounded-[20px] border border-line bg-surface p-5">
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
                      <div key={req.id} className="rounded-[14px] bg-canvas p-3">
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

      {/* ============ (c) TALEPLERİM ============ */}
      <section id="taleplerim" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Taleplerim</h2>

        {myRequests.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Henüz talep göndermediniz"
            description="Ağ havuzundan ilginizi çeken bir ilana iş birliği talebi gönderin; kabul edilince iletişim burada açılır."
          />
        ) : (
          <div className="space-y-3">
            {myRequests.map((req) => (
              <div key={req.id} className="rounded-[20px] border border-line bg-surface p-5">
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

      {/* ============ (d) TALEP HAVUZU ============ */}
      <section id="talep-havuzu" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-950">Talep havuzu</h2>
            <p className="text-xs text-text-muted">
              Diğer ofislerin alıcı talepleri — müşteri bilgisi maskeli, bütçe yuvarlanmış aralık.
            </p>
          </div>
          {canCreate ? <ShareDemandDialog demands={myOpenDemands} /> : null}
        </div>

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
          <EmptyState
            icon={Megaphone}
            title="Havuzda talep yok"
            description={
              hasDemandFilters
                ? "Seçili filtrelerde ağa açılmış alıcı talebi bulunamadı. Filtreleri genişletmeyi deneyin."
                : "Henüz ağa açılmış alıcı talebi bulunmuyor. Açık taleplerinizden birini paylaşarak diğer ofislerin portföylerini talebinize çekin."
            }
            action={canCreate ? { node: <ShareDemandDialog demands={myOpenDemands} /> } : undefined}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demandPool.map((item) => (
              <div key={item.networkDemandId} className="flex flex-col rounded-[20px] border border-line bg-surface p-5">
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
                  <p className="mt-2 rounded-[10px] bg-canvas p-2 text-xs text-text-muted">{item.note}</p>
                ) : null}

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-extrabold text-ink-950">
                      {formatBudgetRange(item.budgetMin, item.budgetMax)}
                    </p>
                    <p className="text-[11px] font-semibold text-mint-600">
                      %{item.commissionSharePct} komisyon paylaşımı
                    </p>
                  </div>
                  <p className="text-[11px] text-text-faint">{listingAge(item.sharedAt)}</p>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {item.isOwn ? (
                    <p className="text-xs text-text-faint">Kendi talebiniz — Paylaştığım Talepler bölümünden yönetin.</p>
                  ) : item.myResponseStatus ? (
                    <Badge variant={REQUEST_STATUS_VARIANT[item.myResponseStatus]} size="sm">
                      Öneriniz: {REQUEST_STATUS_LABELS[item.myResponseStatus]}
                    </Badge>
                  ) : canCreate ? (
                    <DemandResponseDialog
                      networkDemandId={item.networkDemandId}
                      demandSummary={demandSummary(item) || "Alıcı talebi"}
                      officeName={item.officeName}
                      properties={hintProperties}
                    />
                  ) : (
                    <p className="text-xs text-text-faint">Öneri göndermek için yetkiniz yok.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ (e) PAYLAŞTIĞIM TALEPLER ============ */}
      <section id="paylastigim-talepler" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Paylaştığım talepler</h2>

        {myDemands.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Henüz talep paylaşmadınız"
            description="Açık bir alıcı talebinizi komisyon paylaşım oranıyla ağa açın; diğer ofislerden portföy önerileri alın."
            action={canCreate ? { node: <ShareDemandDialog demands={myOpenDemands} /> } : undefined}
          />
        ) : (
          <div className="space-y-4">
            {myDemands.map((nd) => (
              <div key={nd.id} className="rounded-[20px] border border-line bg-surface p-5">
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
                      <div key={resp.id} className="rounded-[14px] bg-canvas p-3">
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

      {/* ============ (f) TALEP YANITLARIM ============ */}
      <section id="talep-yanitlarim" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Talep yanıtlarım</h2>

        {myDemandResponses.length === 0 ? (
          <EmptyState
            icon={Home}
            title="Henüz portföy önerisi göndermediniz"
            description="Talep havuzundan uygun bir talebe portföy önerinizi gönderin; kabul edilince iletişim burada açılır."
          />
        ) : (
          <div className="space-y-3">
            {myDemandResponses.map((resp) => (
              <div key={resp.id} className="rounded-[20px] border border-line bg-surface p-5">
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
    </div>
  );
}
