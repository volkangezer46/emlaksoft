import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Clock3,
  Crosshair,
  MapPin,
  MessageCircle,
  PhoneCall,
  Share2,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import {
  fetchTenantMatchingWeights,
  scoreDemandProperty,
  tierCls,
  tierLabel,
  tierOf,
  type MatchDemand,
  type MatchingWeights,
  type MatchProperty,
} from "@/lib/matching";
import { moneyTry } from "@/lib/leak-shield";
import { msSince } from "@/lib/clock";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
// Talep formu tek kopya müşteri-360'ta yaşar — aynı dialog + updateDemand action'ı
import { EditDemandDialog } from "../../musteriler/[id]/edit-demand-dialog";
import { DemandStatusSwitch } from "./demand-status-switch";

type Rel = { id?: string; name?: string; full_name?: string } | { id?: string; name?: string; full_name?: string }[] | null;

function relOne<T extends { id?: string; name?: string; full_name?: string }>(value: Rel): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) as T;
}

function budgetLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `${moneyTry(min)} – ${moneyTry(max)}`;
  if (max != null) return `≤ ${moneyTry(max)}`;
  if (min != null) return `≥ ${moneyTry(min)}`;
  return "Bütçe yok";
}

const statusLabel: Record<string, string> = {
  new: "Yeni",
  active: "Aktif",
  matched: "Eşleşti",
  closed: "Kapalı",
};

const urgencyLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

/** Talep yaşı — "kaç gündür açık" (liste sayfasındaki kuralla aynı). */
function demandAge(iso: string, status: string) {
  const days = Math.floor(msSince(iso) / 86_400_000);
  if (status === "closed") return days <= 0 ? "Bugün açıldı" : `${days} gün önce açıldı`;
  if (days <= 0) return "Bugün açıldı";
  if (days === 1) return "1 gündür açık";
  return `${days} gündür açık`;
}

function longDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));
}

// Eşleştirme motorundaki SQL ön filtre deseniyle aynı işlem türü varyantları
const SALE_VARIANTS = ["Satılık", "satılık", "Satilik", "satilik", "SATILIK", "sale", "Sale", "Satış", "satış", "Satis", "satis"];
const RENT_VARIANTS = ["Kiralık", "kiralık", "Kiralik", "kiralik", "KİRALIK", "rent", "Rent", "Kira", "kira"];
const isSaleTx = (v: string) => ["satılık", "satilik", "sale", "satış", "satis"].some((x) => v.includes(x));
const isRentTx = (v: string) => ["kiralık", "kiralik", "rent", "kira"].some((x) => v.includes(x));

export default async function DemandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("demands");
  const canEdit = (perms.demands ?? []).includes("edit");
  const { id } = await params;
  const supabase = await createClient();

  const { data: demandData } = await supabase
    .from("customer_demands")
    .select(
      "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, created_at, province_id, district_id, neighborhood_id, customer:customers(id, full_name, phone, assigned_to), province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!demandData) notFound();

  const demand = demandData as unknown as MatchDemand & {
    created_at: string;
    neighborhood_id: string | null;
    customer: Rel;
    province: Rel;
    district: Rel;
    neighborhood: Rel;
  };
  const customer = relOne<{ id: string; full_name: string; phone: string | null; assigned_to?: string | null }>(
    demand.customer,
  );
  const provinceName = relOne<{ name: string }>(demand.province)?.name ?? null;
  const districtName = relOne<{ name: string }>(demand.district)?.name ?? null;
  const neighborhoodName = relOne<{ name: string }>(demand.neighborhood)?.name ?? null;

  // ── Aday portföyler: eslestirme sayfasındaki SQL ön filtre deseni (tek talep) ──
  const rawTx = (demand.transaction_type ?? "").trim();
  const normTx = rawTx.toLocaleLowerCase("tr-TR");
  const txVariants = new Set<string>();
  if (normTx) {
    if (isSaleTx(normTx)) SALE_VARIANTS.forEach((v) => txVariants.add(v));
    else if (isRentTx(normTx)) RENT_VARIANTS.forEach((v) => txVariants.add(v));
    txVariants.add(rawTx);
  }

  let propQuery = supabase
    .from("properties")
    .select(
      "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features",
    )
    .is("deleted_at", null)
    .in("status", ["live", "draft", "reserved", "Yayında"]);
  if (normTx && txVariants.size > 0) propQuery = propQuery.in("transaction_type", [...txVariants]);
  // İli null portföy "İl (belirsiz)" olarak yine skorlanır — dışarıda bırakma.
  if (demand.province_id) propQuery = propQuery.or(`province_id.is.null,province_id.eq.${demand.province_id}`);

  const [
    { data: provinces },
    fetchedWeights,
    { data: propertiesData },
    { data: feedbackData },
    { data: networkRow },
    { data: agentProfile },
  ] = await Promise.all([
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    fetchTenantMatchingWeights(supabase),
    propQuery.order("created_at", { ascending: false }).limit(200),
    customer
      ? supabase
          .from("portal_match_feedback")
          .select("property_id, verdict")
          .eq("customer_id", customer.id)
      : Promise.resolve({ data: [] as { property_id: string; verdict: string }[] }),
    supabase
      .from("network_demands")
      .select("id, status, commission_share_pct")
      .eq("demand_id", id)
      .maybeSingle(),
    customer?.assigned_to
      ? supabase.from("profiles").select("full_name").eq("id", customer.assigned_to).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string } | null }),
  ]);

  // Ofise özel kriter ağırlıkları — merkez yardımcı (lib/matching tek doğruluk kaynağı)
  const tenantWeights: MatchingWeights | null = fetchedWeights ?? null;

  const properties = (propertiesData ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];

  // Müşteri portal geri bildirimi: disliked gizlenir, liked +10 bonus + rozet
  const likedIds = new Set<string>();
  const dislikedIds = new Set<string>();
  for (const fb of feedbackData ?? []) {
    if (fb.verdict === "liked") likedIds.add(fb.property_id);
    else if (fb.verdict === "disliked") dislikedIds.add(fb.property_id);
  }

  type Match = {
    property: MatchProperty;
    score: number;
    tier: ReturnType<typeof scoreDemandProperty>["tier"];
    reasons: ReturnType<typeof scoreDemandProperty>["reasons"];
    likedByCustomer: boolean;
  };

  const matches: Match[] = [];
  let hiddenByFeedback = 0;
  for (const property of properties) {
    const result = scoreDemandProperty(demand, property, tenantWeights);
    if (dislikedIds.has(property.id)) {
      if (result.score >= 35) hiddenByFeedback += 1;
      continue;
    }
    const liked = likedIds.has(property.id);
    const score = liked ? Math.min(100, result.score + 10) : result.score;
    if (score < 35) continue;
    matches.push({
      property,
      score,
      tier: liked ? tierOf(score) : result.tier,
      reasons: result.reasons,
      likedByCustomer: liked,
    });
  }
  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, 10);

  // Kapak görselleri — portföy listesindeki desen (yalnız listelenen 10 portföy için)
  const coverByProperty = new Map<string, string>();
  if (topMatches.length > 0) {
    const { data: covers } = await supabase
      .from("property_media")
      .select("id, property_id")
      .in("property_id", topMatches.map((m) => m.property.id))
      .eq("is_cover", true);
    for (const cover of (covers ?? []) as { id: string; property_id: string }[]) {
      if (!coverByProperty.has(cover.property_id)) coverByProperty.set(cover.property_id, cover.id);
    }
  }

  const criteriaChips = [
    demand.rooms,
    demand.min_sqm != null ? `≥ ${demand.min_sqm} m²` : null,
    demand.urgency ? `Aciliyet: ${urgencyLabel[demand.urgency] ?? demand.urgency}` : null,
  ].filter((x): x is string => x != null);

  const locationLabel = [provinceName, districtName, neighborhoodName].filter(Boolean).join(" / ") || "Konum belirtilmedi";
  const agentName = agentProfile?.full_name ?? null;
  const phoneHref = customer?.phone ? toTelHref(customer.phone) : null;
  const waHref = customer?.phone ? toWhatsAppLink(customer.phone) : null;

  return (
    <div className="space-y-6">
      {/* ── Hero: talep künyesi ─────────────────────────────────────────── */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-brand-600/25 blur-[80px]" />
        <div className="relative">
          <Link
            href="/app/talepler"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/60 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Talepler
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
                  <Target className="h-3.5 w-3.5" /> {demand.transaction_type}
                  {demand.property_type ? ` · ${demand.property_type}` : ""}
                </span>
                <span className="rounded-full bg-mint-500/15 px-2.5 py-0.5 text-[11px] font-bold text-mint-400">
                  {statusLabel[demand.status] ?? demand.status}
                </span>
                {demand.urgency ? (
                  <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                    {urgencyLabel[demand.urgency] ?? demand.urgency}
                  </span>
                ) : null}
                {networkRow ? (
                  <Link
                    href="/app/ag"
                    title={`Ağ talep havuzunda ${networkRow.status === "active" ? "paylaşımda" : "duraklatıldı"} · komisyon paylaşımı %${Number(networkRow.commission_share_pct)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-cyan-400/15 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300 transition hover:bg-cyan-400/25"
                  >
                    <Share2 className="h-3 w-3" />
                    {networkRow.status === "active" ? "Ağda paylaşımda" : "Ağ paylaşımı duraklatıldı"}
                  </Link>
                ) : null}
              </div>
              <h1 className="mt-2 font-display text-3xl font-extrabold text-white">
                {budgetLabel(
                  demand.budget_min != null ? Number(demand.budget_min) : null,
                  demand.budget_max != null ? Number(demand.budget_max) : null,
                )}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/60">
                <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {locationLabel}</span>
                {criteriaChips.map((c) => <span key={c}>{c}</span>)}
                <span className={`flex items-center gap-1.5 ${demand.status !== "closed" && demand.urgency === "urgent" ? "font-semibold text-amber-300" : ""}`}>
                  <Clock3 className="h-4 w-4" /> {demandAge(demand.created_at, demand.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/40">
                {longDate(demand.created_at)} tarihinde açıldı
                {agentName ? ` · Danışman: ${agentName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && customer ? (
                <div className="rounded-[10px] border border-white/15 bg-white/10 px-3 py-2 backdrop-blur transition hover:border-white/30 [&_button]:text-white [&_button]:hover:no-underline">
                  <EditDemandDialog
                    demand={{
                      id: demand.id,
                      transaction_type: demand.transaction_type,
                      property_type: demand.property_type,
                      budget_min: demand.budget_min != null ? Number(demand.budget_min) : null,
                      budget_max: demand.budget_max != null ? Number(demand.budget_max) : null,
                      rooms: demand.rooms,
                      min_sqm: demand.min_sqm != null ? Number(demand.min_sqm) : null,
                      urgency: demand.urgency,
                      status: demand.status,
                      province_id: demand.province_id,
                      district_id: demand.district_id,
                      neighborhood_id: demand.neighborhood_id,
                    }}
                    provinces={provinces ?? []}
                    customerId={customer.id}
                  />
                </div>
              ) : null}
              <Link
                href={`/app/eslestirme?demand=${demand.id}`}
                className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <Crosshair className="h-4 w-4" /> Eşleştirmede aç
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* ── Bu talebin eşleşmeleri ──────────────────────────────────────── */}
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Crosshair className="h-4 w-4 text-brand-600" /> Bu talebin eşleşmeleri
              </h2>
              <p className="text-xs text-text-muted">
                {matches.length} portföy skorlandı · ilk {topMatches.length} gösteriliyor · skor ≥ 35
                {tenantWeights ? " · ofise özel ağırlıklar" : ""}
              </p>
              {hiddenByFeedback > 0 ? (
                <p className="mt-0.5 text-xs text-amber-600">
                  {hiddenByFeedback} portföy müşteri geri bildirimiyle gizlendi (&quot;müşteri ilgilenmedi&quot;).
                </p>
              ) : null}
            </div>
            <Link
              href={`/app/eslestirme?demand=${demand.id}`}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
            >
              Tümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {topMatches.length === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center">
              <Crosshair className="h-8 w-8 text-text-faint" />
              <p className="mt-3 font-display font-bold text-ink-950">Henüz eşleşen portföy yok</p>
              <p className="mt-1 max-w-md text-sm text-text-muted">
                Kriterlere uyan yayında portföy eklendiğinde burada skorlanır.
              </p>
              <Link href="/app/portfoyler" className="mt-4 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                Portföylere git
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {topMatches.map((m) => {
                const coverId = coverByProperty.get(m.property.id);
                return (
                  <article key={m.property.id} className="flex items-center gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02]">
                    <Link
                      href={`/app/portfoyler/${m.property.id}`}
                      className="relative grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[image:var(--grad-brand-soft)]"
                      aria-label={`${m.property.title ?? m.property.property_code} portföyünü aç`}
                    >
                      {coverId ? (
                        <Image
                          src={`/api/property-media/${coverId}`}
                          alt={m.property.title ?? m.property.property_code}
                          fill
                          sizes="80px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <Building2 className="h-6 w-6 text-brand-600/35" />
                      )}
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/portfoyler/${m.property.id}`}
                        className="block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                      >
                        {m.property.title ?? m.property.property_code}
                      </Link>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {m.property.property_code} · {m.property.transaction_type} · {m.property.property_type}
                        {m.property.list_price != null ? ` · ${moneyTry(m.property.list_price)}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.reasons.filter((r) => r.ok).slice(0, 4).map((r) => (
                          <span key={r.label} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[10px] font-semibold text-mint-600">
                            {r.label}
                          </span>
                        ))}
                        {m.likedByCustomer ? (
                          <span
                            className="rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-bold text-mint-600"
                            title="Müşteri portalında bu portföyü beğendi — skora +10 eklendi"
                          >
                            💚 Müşteri beğendi
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-2xl font-extrabold text-ink-950">{m.score}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tierCls(m.tier)}`}>
                          {tierLabel(m.tier)}
                        </span>
                      </div>
                      <Link
                        href={`/app/eslestirme?demand=${demand.id}&property=${m.property.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Eşleştirmede aç <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-4">
          {/* ── Müşteri kartı ─────────────────────────────────────────────── */}
          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Users className="h-4 w-4 text-brand-600" /> Müşteri
            </h2>
            {customer ? (
              <>
                <Link
                  href={`/app/musteriler/${customer.id}`}
                  className="group mt-3 flex items-center justify-between gap-2 rounded-[14px] border border-line bg-canvas/60 px-4 py-3 transition hover:border-brand-300"
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink-950 group-hover:text-brand-600">
                      {customer.full_name}
                    </p>
                    {customer.phone ? (
                      <p className="mt-0.5 text-xs text-text-muted">{formatTurkishPhone(customer.phone)}</p>
                    ) : null}
                    {agentName ? <p className="mt-0.5 text-[11px] text-text-faint">Danışman: {agentName}</p> : null}
                  </div>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
                {customer.phone ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={phoneHref ?? "#"}
                      className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
                    >
                      <PhoneCall className="h-3.5 w-3.5" /> Ara
                    </a>
                    <a
                      href={waHref ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${customer.full_name} ile WhatsApp görüşmesi`}
                      className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-mint-500 hover:text-mint-600"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
                Talebin bağlı olduğu müşteri bulunamadı.
              </p>
            )}
          </section>

          {/* ── Durum ─────────────────────────────────────────────────────── */}
          <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Durum
            </h2>
            {canEdit && customer ? (
              <div className="mt-3">
                <DemandStatusSwitch demandId={demand.id} customerId={customer.id} status={demand.status} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-muted">
                Mevcut durum: <span className="font-semibold text-ink-950">{statusLabel[demand.status] ?? demand.status}</span>
              </p>
            )}
            {networkRow ? (
              <p className="mt-3 text-xs text-text-muted">
                Bu talep ağ havuzunda {networkRow.status === "active" ? "paylaşımda" : "duraklatıldı"} (komisyon %{Number(networkRow.commission_share_pct)}).{" "}
                <Link href="/app/ag" className="font-semibold text-brand-600 hover:underline">Ağı aç →</Link>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
