import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FileCheck2,
  Gauge,
  Landmark,
  MapPin,
  MapPinned,
  Percent,
  RadioTower,
  Siren,
  Sparkles,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { moneyTry } from "@/lib/leak-shield";
import { setPropertyStatus } from "@/app/actions/properties";
import { ClosePortalDialog } from "@/app/app/portallar/portal-dialogs";
import { confirmPortalListing } from "@/app/actions/portal-listings";
import { PropertyWorkflow } from "./property-workflow";
import { EditPropertyDialog } from "./edit-property-dialog";
import { DeletePropertyButton, ReassignProperty } from "./property-admin-actions";
import { PropertyMediaManager, type MediaItem } from "./property-media-manager";
import { AiContentPanel } from "./ai-content-panel";
import { PropertyStatusHistory, PropertyAuthorizationPanel, PublishToPortalsPanel } from "./property-extras";
import { PropertyHealthCard, ListingQualityCard } from "@/components/app/property-health-card";
import { RelatedPropertiesWidget } from "./related-properties-widget";
import { computePropertyHealth, computeListingQuality } from "@/lib/property-health";
import { computePriceHealth } from "@/lib/price-health";
import { isEndeksaConfigured } from "@/lib/integrations/endeksa";
import { isTapusorConfigured } from "@/lib/integrations/tapusor";
import { getConfiguredPortals } from "@/app/actions/portal-publish";
import { getPropertyStatusHistory } from "@/app/actions/property-management";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

type Rel = { name?: string; full_name?: string } | { name?: string; full_name?: string }[] | null;

type Portal = {
  id: string;
  portal_name: string;
  portal_listing_id: string | null;
  portal_url: string | null;
  status: string;
  last_confirmed_at: string | null;
  removed_at: string | null;
  removal_reason: string | null;
};

type Closure = {
  id: string;
  reason: string;
  estimated_lost_commission: number | null;
  competitor_closed: boolean | null;
  closed_by_us: boolean | null;
  created_at: string;
  portal_listing_id: string;
};

function relName(value: Rel, key: "name" | "full_name" = "name") {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row?.[key] as string | undefined) ?? null;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat girilmedi";
  return `${moneyTry(value)}${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

const statusOptions = [
  { value: "draft", label: "Taslak" },
  { value: "live", label: "Yayında" },
  { value: "reserved", label: "Rezerve" },
  { value: "sold", label: "Satıldı" },
  { value: "rented", label: "Kiralandı" },
  { value: "archived", label: "Arşiv" },
];

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canEdit = (perms.properties ?? []).includes("edit");
  const canDelete = (perms.properties ?? []).includes("delete");
  const { id } = await params;
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, property_code, title, transaction_type, property_type, status, list_price, min_price, commission_rate, address_line, province_id, parcel_block, parcel_lot, features, price_health, created_at, updated_at, assigned_to, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!property) notFound();

  const { data: portalsData } = await supabase
    .from("portal_listings")
    .select("id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, removed_at, removal_reason")
    .eq("property_id", id)
    .order("created_at", { ascending: false });

  const portals = (portalsData ?? []) as Portal[];
  const portalIds = portals.map((p) => p.id);

  const [statusHistory, configuredPortals] = await Promise.all([
    getPropertyStatusHistory(id),
    getConfiguredPortals(),
  ]);

  const [{ data: closuresData }, { data: assigneeProfile }, { data: provinces }, { data: teamMembers }, { data: mediaData }] = await Promise.all([
    portalIds.length
      ? supabase
          .from("listing_closures")
          .select("id, reason, estimated_lost_commission, competitor_closed, closed_by_us, created_at, portal_listing_id")
          .in("portal_listing_id", portalIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Closure[] }),
    property.assigned_to
      ? supabase.from("profiles").select("full_name").eq("id", property.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("geo_provinces").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("property_media")
      .select("id, kind, storage_path, external_url, is_cover")
      .eq("property_id", id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
  ]);

  const closures = (closuresData ?? []) as Closure[];
  const media = (mediaData ?? []) as MediaItem[];
  const livePortals = portals.filter((p) => p.status === "live");
  const overdue = livePortals.filter((p) => daysSince(p.last_confirmed_at) >= 7);
  const lostTotal = closures.reduce((s, c) => s + Number(c.estimated_lost_commission || 0), 0);

  const features = (property.features ?? {}) as { rooms?: string | null; sqm?: number | null };
  const province = relName(property.province as Rel);
  const district = relName(property.district as Rel);
  const assignee = assigneeProfile?.full_name ?? null;

  const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
  const healthWarn = property.price_health === "yellow" || property.price_health === "Sarı" || property.price_health === "red";
  const portalHealth = livePortals.length ? (livePortals.length - overdue.length) / livePortals.length : 1;

  const commissionPreview =
    property.list_price && property.commission_rate
      ? Math.round(Number(property.list_price) * (Number(property.commission_rate) / 100))
      : property.list_price
        ? Math.round(Number(property.list_price) * 0.02)
        : 0;

  const endeksaOn = isEndeksaConfigured();
  const tapusorOn = isTapusorConfigured();

  const priceSignal = computePriceHealth({
    listPrice: property.list_price != null ? Number(property.list_price) : null,
    sqm: features.sqm != null ? Number(features.sqm) : null,
    districtHint: district ?? province,
  });

  // Portföy sağlık skoru
  const propertyHealth = computePropertyHealth({
    title:              property.title,
    property_type:      property.property_type,
    transaction_type:   property.transaction_type,
    list_price:         property.list_price != null ? Number(property.list_price) : null,
    address_line:       property.address_line,
    province_id:        property.province_id,
    parcel_block:       property.parcel_block,
    parcel_lot:         property.parcel_lot,
    commission_rate:    property.commission_rate != null ? Number(property.commission_rate) : null,
    features:           property.features as Record<string, unknown> | null,
    authorization_start: (property as unknown as Record<string, string | null>).authorization_start,
    authorization_end:   (property as unknown as Record<string, string | null>).authorization_end,
    authorization_type:  (property as unknown as Record<string, string | null>).authorization_type,
    mediaCount:         (mediaData ?? []).length,
    hasActivePortal:    livePortals.length > 0,
  });

  // İlan kalite puanı (ilk aktif portal için)
  const firstPortal = portals[0];
  const listingQuality = firstPortal ? computeListingQuality({
    title:       property.title,
    description: (property as unknown as Record<string, string | null>).description ?? null,
    mediaCount:  (mediaData ?? []).length,
    hasPortalId: Boolean(firstPortal.portal_listing_id),
    hasPortalUrl: Boolean(firstPortal.portal_url),
    priceSet:    Boolean(property.list_price),
    locationSet: Boolean(property.province_id && property.address_line),
  }) : null;

  return (
    <div className="space-y-6">
      <Link href="/app/portfoyler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Portföy merkezine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80">{property.property_code}</span>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${healthGood ? "bg-mint-500/20 text-mint-300" : healthWarn ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/60"}`}>
                Fiyat {property.price_health ?? "bekliyor"}
              </span>
              <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-[10px] font-bold text-cyan-300">{property.status}</span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold text-white md:text-3xl">
              {property.title ?? property.property_code}
            </h1>
            <p className="mt-1 text-sm text-white/60">
              {property.transaction_type} · {property.property_type}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-white/70">
              <MapPin className="h-3.5 w-3.5 text-mint-400" />
              {[property.address_line, district, province].filter(Boolean).join(" · ") || "Konum belirtilmedi"}
            </p>
            <p className="mt-4 font-display text-3xl font-extrabold text-white">
              {formatPrice(property.list_price != null ? Number(property.list_price) : null, property.transaction_type)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/app/portallar" className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950">
                <RadioTower className="h-4 w-4" /> Portal bağla
              </Link>
              {canEdit ? (
                <EditPropertyDialog
                  property={{
                    id: property.id,
                    title: property.title,
                    transaction_type: property.transaction_type,
                    property_type: property.property_type,
                    list_price: property.list_price != null ? Number(property.list_price) : null,
                    min_price: property.min_price != null ? Number(property.min_price) : null,
                    commission_rate: property.commission_rate != null ? Number(property.commission_rate) : null,
                    address_line: property.address_line,
                    province_id: property.province_id,
                    features: (property.features ?? {}) as { rooms?: string | null; sqm?: number | null },
                  }}
                  provinces={provinces ?? []}
                />
              ) : null}
              <Link href="/app/kayip-kacak" className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                <Siren className="h-4 w-4" /> Kayıp-kaçak
              </Link>
              <Link href={`/app/eslestirme?property=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Eşleştir
              </Link>
              <Link href="/app/anlasmalar" className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Pipeline
              </Link>
              {canDelete ? <DeletePropertyButton propertyId={property.id} /> : null}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--mint-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - portalHealth) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold">%{Math.round(portalHealth * 100)}</p>
                <p className="text-[9px] text-white/45">teyit</p>
              </div>
            </div>
            <div className="space-y-2 text-xs text-white/70">
              <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-mint-400" /> {livePortals.length} canlı portal</div>
              <div className="flex items-center gap-2"><FileCheck2 className="h-3.5 w-3.5 text-amber-300" /> {overdue.length} teyit gecikmiş</div>
              <div className="flex items-center gap-2"><Siren className="h-3.5 w-3.5 text-danger-400" /> {moneyTry(lostTotal)} kayıp</div>
              {canEdit ? (
                <ReassignProperty propertyId={property.id} currentAssignee={property.assigned_to} members={teamMembers ?? []} />
              ) : (
                <div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-white/50" /> {assignee ?? "Atanmadı"}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <PropertyMediaManager propertyId={property.id} media={media} canEdit={canEdit} />

      <AiContentPanel propertyId={property.id} />

      <PropertyWorkflow
        propertyId={property.id}
        listPrice={property.list_price != null ? Number(property.list_price) : null}
        transactionType={property.transaction_type}
      />

      <section className="rounded-[20px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-violet-600">
            <Sparkles className="h-4 w-4" /> Endeksa &amp; Tapusor derin değerleme
          </p>
          <Link
            href={`/app/degerleme?property=${property.id}`}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-800"
          >
            Bu portföy için değerleme oluştur
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${endeksaOn ? "border-cyan-400/30 bg-cyan-400/5" : "border-line bg-canvas/60"}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${endeksaOn ? "bg-cyan-500/15 text-cyan-700" : "bg-ink-950/6 text-text-faint"}`}>
              <Landmark className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-950">Endeksa bölge endeksi</p>
              <p className="text-[11px] text-text-muted">{endeksaOn ? "Canlı — değerlemede otomatik kullanılır" : "Bağlantı bekliyor (ENDEKSA_CLIENT_ID)"}</p>
            </div>
          </div>
          <div className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${tapusorOn ? "border-violet-400/30 bg-violet-400/5" : "border-line bg-canvas/60"}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${tapusorOn ? "bg-violet-500/15 text-violet-700" : "bg-ink-950/6 text-text-faint"}`}>
              <MapPinned className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-950">Tapusor EDİ + yatırım puanı</p>
              <p className="text-[11px] text-text-muted">
                {tapusorOn
                  ? `Ada ${property.parcel_block ?? "—"} / Parsel ${property.parcel_lot ?? "—"} ile sorgulanır`
                  : "Bağlantı bekliyor (TAPUSOR_API_KEY)"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Gauge className="h-4 w-4" /> Portföy özeti</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Detaylar</h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["Oda", features.rooms ?? "—"],
              ["m²", features.sqm != null ? String(features.sqm) : "—"],
              ["Min. fiyat", property.min_price != null ? moneyTry(Number(property.min_price)) : "—"],
              ["Komisyon", property.commission_rate != null ? `%${property.commission_rate}` : "%2 (varsayılan)"],
              ["Ada / parsel", [property.parcel_block, property.parcel_lot].filter(Boolean).join(" / ") || "—"],
              ["Oluşturma", new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(property.created_at))],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-[14px] border border-amber-400/25 bg-amber-400/5 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
              <Percent className="h-3.5 w-3.5" /> Tahmini ofis komisyonu
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">{moneyTry(commissionPreview)}</p>
            <p className="mt-1 text-[11px] text-text-muted">Liste fiyatı × komisyon oranı (kayıp-kaçak hesabında da kullanılır)</p>
          </div>
          <div className="mt-3 rounded-[14px] border border-line bg-canvas/60 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-text-faint">Price Health</p>
            <p className="mt-1 text-sm font-semibold text-ink-950">
              {priceSignal.health === "green" ? "Yeşil" : priceSignal.health === "yellow" ? "Sarı" : priceSignal.health === "red" ? "Kırmızı" : "Bekliyor"}
              {priceSignal.deltaPct != null ? ` · %${priceSignal.deltaPct}` : ""}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">{priceSignal.note}</p>
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="text-xs font-semibold text-mint-600">Durum yönetimi</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Portföy durumu</h2>
          {canEdit ? (
            <form action={setPropertyStatus} className="mt-5 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={property.id} />
              <label className="min-w-[160px] flex-1 text-xs font-medium text-text-muted">
                Durum
                <select name="status" defaultValue={property.status} className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400">
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800">
                Kaydet
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-text-muted">Durum: <span className="font-semibold text-ink-950">{statusOptions.find((o) => o.value === property.status)?.label ?? property.status}</span></p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-text-muted">
            Yayına alındığında Portal Kontrol üzerinden ilan no/URL bağlayın. Kapanış formu zorunlu tutulur; rakip kapanışlar kayıp-kaçağa düşer.
          </p>
        </section>
      </div>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <RadioTower className="h-4 w-4 text-brand-600" /> Portal kayıtları
            </h2>
            <p className="text-xs text-text-muted">{portals.length} kayıt · {livePortals.length} canlı</p>
          </div>
          <Link href="/app/portallar" className="text-xs font-semibold text-brand-600">Portal Kontrol</Link>
        </div>
        {portals.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Bu portföye henüz portal bağlanmamış. Portal Kontrol’den ilan no veya link ekleyin.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {portals.map((p) => {
              const overdueDays = daysSince(p.last_confirmed_at);
              const isLive = p.status === "live";
              return (
                <article key={p.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.3fr_1fr_auto] lg:items-center">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {p.portal_name} {p.portal_listing_id ? `#${p.portal_listing_id}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {isLive
                        ? overdueDays >= 7
                          ? `${overdueDays} gündür teyit yok`
                          : `Son teyit: ${overdueDays === 0 ? "bugün" : `${overdueDays} gün önce`}`
                        : p.removal_reason ?? "Yayından kalktı"}
                    </p>
                    {p.portal_url ? (
                      <a href={p.portal_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                        İlanı aç <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                  <div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isLive ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"}`}>
                      {isLive ? "Canlı" : p.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isLive && canEdit ? (
                      <>
                        <form action={confirmPortalListing}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="rounded-[9px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 hover:border-brand-300">
                            Teyit et
                          </button>
                        </form>
                        <ClosePortalDialog listingId={p.id} label={`${p.portal_name} · ${property.property_code}`} />
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {closures.length > 0 ? (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Siren className="h-4 w-4 text-danger-500" /> Kapanış / kayıp kayıtları
            </h2>
          </div>
          <div className="divide-y divide-line">
            {closures.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink-950">{c.reason}</p>
                  <p className="text-xs text-text-muted">
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(c.created_at))}
                    {c.competitor_closed ? " · Rakip" : ""}
                    {c.closed_by_us ? " · Bizim" : ""}
                  </p>
                </div>
                <p className={`font-display text-sm font-extrabold ${Number(c.estimated_lost_commission || 0) > 0 ? "text-danger-500" : "text-mint-600"}`}>
                  {Number(c.estimated_lost_commission || 0) > 0
                    ? `−${moneyTry(Number(c.estimated_lost_commission))}`
                    : "Kayıp yok"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Portföy sağlık skoru + ilan kalite puanı */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PropertyHealthCard health={propertyHealth} />
        {listingQuality && <ListingQualityCard quality={listingQuality} />}
      </div>

      {/* Yetki belgesi */}
      <PropertyAuthorizationPanel
        propertyId={id}
        initial={{
          authStart: (property as unknown as Record<string, string | null>).authorization_start ?? null,
          authEnd:   (property as unknown as Record<string, string | null>).authorization_end   ?? null,
          authType:  (property as unknown as Record<string, string | null>).authorization_type  ?? null,
          authNotes: (property as unknown as Record<string, string | null>).authorization_notes ?? null,
        }}
      />

      {/* Portale yayınla */}
      <PublishToPortalsPanel
        propertyId={id}
        configuredPortals={configuredPortals}
      />

      {/* Durum geçmişi */}
      <PropertyStatusHistory
        propertyId={id}
        initialHistory={statusHistory as Parameters<typeof PropertyStatusHistory>[0]["initialHistory"]}
      />

      {/* Benzer portföyler */}
      <RelatedPropertiesWidget
        currentId={id}
        transactionType={property.transaction_type}
        propertyType={property.property_type}
        provinceId={property.province_id}
      />
    </div>
  );
}
