import { Suspense } from "react";
import { CustomFieldsPanel } from "@/components/app/custom-fields-panel";
import Link from "@/components/ui/smart-link";
import { BRAND_ICONS, IconChip } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { prefillHref } from "@/lib/prefill-params";
import Image from "next/image";
import { NeighborhoodNotesPanel } from "@/components/app/neighborhood-notes-panel";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Clock3,
  History,
  Crosshair,
  MapPin,
  MessageCircle,
  PhoneCall,
  Share2,
  Target,
  Users,
  Heart,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import {
  fetchTenantMatchingWeights,
  tierCls,
  tierLabel,
  type MatchDemand,
  type MatchingWeights,
} from "@/lib/matching";
import { loadDemandMatches, MATCH_SHOW_MIN } from "@/lib/match-candidates";
import { suggestWidening, WIDEN_SUGGEST_BELOW } from "@/lib/match-widen";
import { MatchDismissButton } from "../match-dismiss-button";
import { MatchStateBadge } from "../match-state-badge";
import { SendMatchButton } from "../send-match-button";
import { WidenCriteriaCard } from "./widen-criteria-card";
import { moneyTry } from "@/lib/leak-shield";
import { msSince, now as clockNow } from "@/lib/clock";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
// Talep formu tek kopya müşteri-360'ta yaşar — aynı dialog + updateDemand action'ı
import { EditDemandDialog } from "../../musteriler/[id]/edit-demand-dialog";
import { DemandStatusSwitch } from "./demand-status-switch";
import { extraCriteriaChips, parseDemandCriteria } from "@/lib/demand-criteria";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { countByCategory, filterByCategory, resolveCategory } from "@/lib/activity-timeline";
import { APPT_STATUS_LABEL, APPT_TYPE_LABEL } from "@/lib/activity-timeline-sources";
import { CustomerTasks, type CustomerTaskRow } from "../../musteriler/[id]/customer-tasks";
import { buildDemandEvents, DEMAND_TIMELINE_CATEGORIES, type DemandApptRow, type DemandTaskRow } from "./demand-events";
import { DemandReminder } from "./demand-followup";

export const metadata = { title: "Talep" };

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

function longDateTime(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Eşleşen portföyün kapak küçük resmi: ortak söz çözülünce çizilir, yoksa simge. */
async function MatchCover({ coverMapP, propertyId, alt }: { coverMapP: Promise<Map<string, string>>; propertyId: string; alt: string }) {
  const coverId = (await coverMapP).get(propertyId);
  if (!coverId) return <Building2 className="h-6 w-6 text-brand-600/35" />;
  return <Image src={`/api/property-media/${coverId}/download`} alt={alt} fill sizes="80px" className="object-cover" unoptimized />;
}

export default async function DemandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ kategori?: string; adet?: string; gizlenen?: string }>;
}) {
  // Yetki kapısı + route parametreleri birbirine bağlı değil: tek turda çözülür.
  const [{ perms, tenantId }, { id }, spRaw] = await Promise.all([requireModulePage("demands"), params, searchParams]);
  const canEdit = (perms.demands ?? []).includes("edit");
  const canMatchAct = (perms.matching ?? []).includes("create");
  const taskPerms = perms.tasks ?? [];
  const canTaskView = taskPerms.includes("view");
  const canApptView = (perms.appointments ?? []).includes("view");
  const canApptCreate = (perms.appointments ?? []).includes("create");
  const sp = spRaw ?? {};
  const activeCategory = resolveCategory(sp.kategori, DEMAND_TIMELINE_CATEGORIES.map((c) => c.key));
  const timelineLimit = Math.min(400, Math.max(40, Number.parseInt(sp.adet ?? "", 10) || 40));
  const supabase = await createClient();

  // Talep satırına BAĞLI olmayan okumalar talep sorgusuyla AYNI turda başlar (eskiden talepten sonraki turdaydı).
  const provincesP = provinceOptionsResult({ includeInactive: true });
  const weightsP = fetchTenantMatchingWeights(supabase);
  const networkP = Promise.resolve(
    supabase.from("network_demands").select("id, status, commission_share_pct").eq("demand_id", id).maybeSingle(),
  );
  const { data: demandData } = await supabase
    .from("customer_demands")
    .select(
      "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, created_at, province_id, district_id, neighborhood_id, customer:customers!customer_demands_customer_id_fkey(id, full_name, phone, assigned_to), province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)",
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

  // ── Eşleşmeler: TEK okuyucu (src/lib/match-candidates.ts) — Eşleşme sekmesi ve Müşteri 360 ile aynı aday sorgusu, eşik,
  // müşteri geri bildirimi ve eşleşme durumu (CRM-G3/G4). Görev/randevu/olay sorgularıyla AYNI turda çalışır.
  const showHidden = sp.gizlenen === "1";
  const matchesP = loadDemandMatches(supabase, {
    demands: [demand],
    customerOf: () => customer?.id ?? null,
    includeHidden: true,
    weights: weightsP,
  });

  // Görev/randevu sorguları TEK kez başlar; hem aşağıdaki batch hem zaman tüneli (olay) üreticisi aynı sözleri paylaşır.
  const taskP = Promise.resolve(
    customer && canTaskView
      ? supabase
          .from("tasks")
          .select("id, title, kind, priority, status, due_at, completed_at, created_at")
          .eq("customer_id", customer.id)
          .order("status", { ascending: true })
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(50)
      : { data: [] as DemandTaskRow[] },
  );
  const apptP = Promise.resolve(
    customer && canApptView
      ? supabase
          .from("appointments")
          .select("id, appointment_type, scheduled_at, location, status")
          .eq("customer_id", customer.id)
          .order("scheduled_at", { ascending: false })
          .limit(30)
      : { data: [] as DemandApptRow[] },
  );
  const allEventsP = buildDemandEvents(
    supabase,
    { id: demand.id, created_at: demand.created_at, customerId: customer?.id ?? null },
    Promise.all([taskP, apptP]).then(([t, ap]) => ({ tasks: (t.data ?? []) as DemandTaskRow[], appts: (ap.data ?? []) as DemandApptRow[] })),
  );

  const [
    { data: provinces },
    fetchedWeights,
    matchResult,
    { data: networkRow },
    { data: agentProfile },
    { data: taskRows },
    { data: apptRows },
    allEvents,
  ] = await Promise.all([
    provincesP,
    weightsP,
    matchesP,
    networkP,
    customer?.assigned_to
      ? supabase.from("profiles").select("full_name").eq("id", customer.assigned_to).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string } | null }),
    // Görev/randevu: talep ile görev arasında sütun yok; bağ talebin müşterisi üzerindendir.
    taskP,
    apptP,
    allEventsP,
  ]);
  const tasks = (taskRows ?? []) as DemandTaskRow[];
  const appts = (apptRows ?? []) as DemandApptRow[];
  const eventCounts = countByCategory(allEvents);
  const timelineBase = `/app/talepler/${demand.id}`;
  const timelineCategories = DEMAND_TIMELINE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: eventCounts[c.key] ?? 0 }));
  const recentAppts = appts.filter((a) => a.status !== "cancelled").slice(0, 6);

  // Ofise özel kriter ağırlıkları — merkez yardımcı (lib/matching tek doğruluk kaynağı)
  const tenantWeights: MatchingWeights | null = fetchedWeights ?? null;

  // Gizlenenler (müşteri beğenmedi / "uygun değil") her zaman SAYILIR; listeye yalnız ?gizlenen=1 ile döner.
  const matches = showHidden ? matchResult.pairs : matchResult.pairs.filter((m) => m.hiddenBy == null);
  const visibleCount = matchResult.pairs.length - matchResult.hiddenByFeedback - matchResult.hiddenDismissed;
  const topMatches = matches.slice(0, 10);
  const nowMs = clockNow();

  // CRM-G6: az/sıfır eşleşmede AYNI aday kümesiyle "kriteri genişlet" önerileri (kapalı talepte yok).
  const widenSuggestions =
    demand.status !== "closed" && visibleCount < WIDEN_SUGGEST_BELOW && !matchResult.error
      ? suggestWidening({
          demand,
          properties: matchResult.properties,
          weights: tenantWeights,
          customerId: customer?.id ?? null,
          feedback: matchResult.feedback,
          states: matchResult.states,
        })
      : [];

  // Kapak görselleri — portföy listesindeki desen (yalnız listelenen 10 portföy için)
  // Kapaklar listeyi BEKLETMEZ: sözle başlar, her küçük resim kendi Suspense sınırında çözülür (üçüncü ardışık tur kalktı).
  const coverMapP: Promise<Map<string, string>> = Promise.resolve(
    topMatches.length > 0
      ? supabase
          .from("property_media")
          .select("id, property_id")
          .in("property_id", topMatches.map((m) => m.property.id))
          .eq("is_cover", true)
      : { data: [] as { id: string; property_id: string }[] },
  ).then(
    ({ data: covers }) => {
      const map = new Map<string, string>();
      for (const cover of (covers ?? []) as { id: string; property_id: string }[]) {
        if (!map.has(cover.property_id)) map.set(cover.property_id, cover.id);
      }
      return map;
    },
    () => new Map<string, string>(),
  );

  const criteriaChips = [
    demand.rooms,
    demand.min_sqm != null ? `≥ ${demand.min_sqm} m²` : null,
    ...extraCriteriaChips(parseDemandCriteria(demand.criteria)),
    demand.urgency ? `Aciliyet: ${urgencyLabel[demand.urgency] ?? demand.urgency}` : null,
  ].filter((x): x is string => x != null);

  const locationLabel = [provinceName, districtName, neighborhoodName].filter(Boolean).join(" / ") || "Konum belirtilmedi";
  const agentName = agentProfile?.full_name ?? null;
  const phoneHref = customer?.phone ? toTelHref(customer.phone) : null;
  const waHref = customer?.phone ? toWhatsAppLink(customer.phone) : null;

  return (
    <div className="space-y-6">
      {/* ── Hero: talep künyesi ─────────────────────────────────────────── */}
      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
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
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-cyan-400">
                  <Target className="h-3.5 w-3.5" /> {demand.transaction_type}
                  {demand.property_type ? ` · ${demand.property_type}` : ""}
                </span>
                <span className="rounded-full bg-mint-500/15 px-2.5 py-0.5 text-xs font-bold text-mint-400">
                  {statusLabel[demand.status] ?? demand.status}
                </span>
                {demand.urgency ? (
                  <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                    {urgencyLabel[demand.urgency] ?? demand.urgency}
                  </span>
                ) : null}
                {networkRow ? (
                  <Link
                    href="/app/ag"
                    title={`Ağ talep havuzunda ${networkRow.status === "active" ? "paylaşımda" : "duraklatıldı"} · komisyon paylaşımı %${Number(networkRow.commission_share_pct)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-cyan-400/15 px-2.5 py-0.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/25"
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
                <div className="rounded-[var(--radius-control)] border border-white/15 bg-white/10 px-3 py-2 backdrop-blur transition hover:border-white/30 [&_button]:text-white [&_button]:hover:no-underline">
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
                href={`/app/talepler?sekme=eslesme&demand=${demand.id}`}
                className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <Crosshair className="h-4 w-4" /> Eşleştirmede aç
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* ── Bu talebin eşleşmeleri ──────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
        <section id="eslesmeler" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2.5 font-display font-bold text-ink-950">
                <IconChip icon={BRAND_ICONS.eslesme} tone="brand" size="sm" /> Bu talebin eşleşmeleri
              </h2>
              <p className="text-xs text-text-muted">
                {visibleCount} uygun portföy · ilk {topMatches.length} gösteriliyor · skor ≥ {MATCH_SHOW_MIN}
                {tenantWeights ? " · ofise özel ağırlıklar" : ""}
              </p>
              {matchResult.truncated ? (
                <p className="mt-0.5 text-xs text-amber-700">Uygun portföy çok: yalnız en yeni portföyler tarandı.</p>
              ) : null}
              {matchResult.hiddenByFeedback + matchResult.hiddenDismissed > 0 ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-700">
                  <span>
                    {[
                      matchResult.hiddenDismissed > 0 ? `${matchResult.hiddenDismissed} öneri "uygun değil" işaretli` : null,
                      matchResult.hiddenByFeedback > 0 ? `${matchResult.hiddenByFeedback} öneriyi müşteri beğenmedi` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Link
                    href={showHidden ? `/app/talepler/${demand.id}#eslesmeler` : `/app/talepler/${demand.id}?gizlenen=1#eslesmeler`}
                    className="focus-ring inline-flex min-h-8 items-center rounded-full border border-line bg-surface px-2.5 font-semibold text-ink-950 hover:border-brand-300 hover:text-brand-600 touch:min-h-11"
                  >
                    {showHidden ? "Gizlenenleri sakla" : "Gizlenenleri göster"}
                  </Link>
                </p>
              ) : null}
            </div>
            <Link
              href={`/app/talepler?sekme=eslesme&demand=${demand.id}`}
              className="focus-ring inline-flex min-h-8 shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
            >
              Tümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {matchResult.error ? (
            <p role="alert" className="border-b border-line bg-danger-500/10 px-5 py-3 text-sm text-ink-950">
              {matchResult.error} Boş liste &quot;eşleşme yok&quot; anlamına gelmez.
            </p>
          ) : null}

          {topMatches.length === 0 ? (
            <EmptyState
              variant="full"
              bare
              icon={BRAND_ICONS.eslesme}
              title="Henüz eşleşen portföy yok"
              description={
                widenSuggestions.length > 0
                  ? "Aşağıdaki kriter genişletme önerileriyle uygun portföy bulabilirsiniz."
                  : "Kriterlere uyan portföy eklendiğinde burada skorlanır ve size bildirim gelir."
              }
              secondary={{ href: "/app/portfoyler", label: "Portföylere git" }}
            />
          ) : (
            <div className="divide-y divide-line">
              {topMatches.map((m) => {
                const opened = Boolean(m.state?.share_token && matchResult.openedTokens.has(m.state.share_token));
                return (
                  <article key={m.property.id} className={`px-4 py-4 transition hover:bg-brand-600/[0.02] sm:px-5 ${m.hiddenBy ? "bg-canvas/60 opacity-75" : ""}`}>
                    <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                      <Link
                        href={`/app/portfoyler/${m.property.id}`}
                        className="relative grid h-14 w-16 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] bg-[image:var(--grad-brand-soft)] sm:h-16 sm:w-20"
                        aria-label={`${m.property.title ?? m.property.property_code} portföyünü aç`}
                      >
                        <Suspense fallback={<Building2 className="h-6 w-6 text-brand-600/35" />}>
                          <MatchCover coverMapP={coverMapP} propertyId={m.property.id} alt={m.property.title ?? m.property.property_code} />
                        </Suspense>
                      </Link>

                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/app/portfoyler/${m.property.id}`}
                          className="block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                        >
                          {m.property.title ?? m.property.property_code}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                          {m.property.property_code} · {m.property.transaction_type} · {m.property.property_type}
                          {m.property.list_price != null ? ` · ${moneyTry(m.property.list_price)}` : ""}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {m.reasons.filter((r) => r.ok).slice(0, 4).map((r) => (
                            <span key={r.label} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-semibold text-mint-600">
                              {r.label}
                            </span>
                          ))}
                          {m.likedByCustomer ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-600"
                              title="Müşteri portalında bu portföyü beğendi — skora +10 eklendi"
                            >
                              <Heart className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          Müşteri beğendi
                            </span>
                          ) : null}
                          {m.hiddenBy === "feedback" ? (
                            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-700">Müşteri beğenmedi</span>
                          ) : null}
                          <MatchStateBadge state={m.state} nowMs={nowMs} opened={opened} />
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-display text-2xl font-extrabold leading-none text-ink-950">{m.score}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tierCls(m.tier)}`}>
                          {tierLabel(m.tier)}
                        </span>
                      </div>
                    </div>
                    {/* Eylemler: her zaman görünür (hover'a bağlı değil); mobilde tam genişlik satır. */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:pl-24">
                      {canMatchAct && m.hiddenBy == null ? <SendMatchButton demandId={demand.id} propertyId={m.property.id} /> : null}
                      {canMatchAct && m.hiddenBy !== "feedback" ? (
                        <MatchDismissButton demandId={demand.id} propertyId={m.property.id} dismissed={m.hiddenBy === "dismissed"} />
                      ) : null}
                      {canApptCreate && customer ? (
                        <Link
                          href={prefillHref("/app/randevular/yeni", { customerId: customer.id, propertyId: m.property.id, demandId: demand.id })}
                          className="focus-ring inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-300 touch:min-h-11"
                        >
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Randevu ver
                        </Link>
                      ) : null}
                      <Link
                        href={`/app/talepler?sekme=eslesme&demand=${demand.id}&property=${m.property.id}`}
                        className="focus-ring ml-auto inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
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

        {widenSuggestions.length > 0 ? (
          <WidenCriteriaCard
            demandId={demand.id}
            currentCount={visibleCount}
            suggestions={widenSuggestions}
            canApply={canEdit}
          />
        ) : null}
        </div>

        <div className="space-y-4 lg:row-span-2">
          {/* Mahalle notları (F5): talebin mahallesi için ofis içi saha notları */}
          <Suspense fallback={null}>
            <NeighborhoodNotesPanel neighborhoodId={demand.neighborhood_id} neighborhoodName={neighborhoodName} />
          </Suspense>
          {/* ── Müşteri kartı ─────────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2.5 font-display font-bold text-ink-950">
              <IconChip icon={Users} tone="brand" size="sm" /> Müşteri
            </h2>
            {customer ? (
              <>
                <Link
                  href={`/app/musteriler/${customer.id}`}
                  className="group mt-3 flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-4 py-3 transition hover:border-brand-300"
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink-950 group-hover:text-brand-600">
                      {customer.full_name}
                    </p>
                    {customer.phone ? (
                      <p className="mt-0.5 text-xs text-text-muted">{formatTurkishPhone(customer.phone)}</p>
                    ) : null}
                    {agentName ? <p className="mt-0.5 text-xs text-text-faint">Danışman: {agentName}</p> : null}
                  </div>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
                {customer.phone ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={phoneHref ?? "#"}
                      className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600"
                    >
                      <PhoneCall className="h-3.5 w-3.5" /> Ara
                    </a>
                    <a
                      href={waHref ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${customer.full_name} ile WhatsApp görüşmesi`}
                      className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-mint-500 hover:text-mint-600"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </div>
                ) : null}
                {taskPerms.includes("create") ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <DemandReminder
                      customerId={customer.id}
                      title={`Talep takibi: ${customer.full_name} · ${demand.transaction_type}${demand.property_type ? ` ${demand.property_type}` : ""}`}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
                Talebin bağlı olduğu müşteri bulunamadı.
              </p>
            )}
          </section>

          {/* ── Durum ─────────────────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2.5 font-display font-bold text-ink-950">
              <IconChip icon={Target} tone="success" size="sm" /> Durum
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
          {tenantId ? (
            <Suspense fallback={null}>
              <CustomFieldsPanel entity="demand" recordId={demand.id} tenantId={tenantId} canEdit={canEdit} canManage={(perms.settings ?? []).includes("edit")} />
            </Suspense>
          ) : null}
        </div>

        {/* Görevler, randevular ve zaman çizelgesi (sol sütunun devamı) */}
        <div className="space-y-4 lg:col-start-1">
          {customer && canTaskView ? (
            <CustomerTasks
              customerId={customer.id}
              tasks={tasks as CustomerTaskRow[]}
              canCreate={taskPerms.includes("create")}
              canEdit={taskPerms.includes("edit")}
              canDelete={taskPerms.includes("delete")}
            />
          ) : null}

          {customer && canApptView ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2.5 font-display font-bold text-ink-950">
                    <IconChip icon={BRAND_ICONS.yerGosterme} tone="success" size="sm" /> Randevular
                  </h2>
                  <p className="text-xs text-text-muted">Bu talebin müşterisiyle planlanan gösterim ve görüşmeler</p>
                </div>
                {canApptCreate ? (
                  <Link
                    href={prefillHref("/app/randevular/yeni", { customerId: customer.id, demandId: demand.id })}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-800"
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> Randevu oluştur
                  </Link>
                ) : null}
              </div>
              {recentAppts.length === 0 ? (
                <EmptyState variant="full" bare icon={BRAND_ICONS.yerGosterme} tone="mint" className="py-6" title="Bu müşteri için randevu yok" description="Güçlü eşleşmelerden birini seçip yer gösterme planlayın; hatırlatma otomatik gider." />
              ) : (
                <ul className="mt-3 space-y-2">
                  {recentAppts.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/app/randevular?customer=${customer.id}`}
                        className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line px-3 py-2.5 text-sm transition hover:border-brand-300"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-semibold text-ink-950">{APPT_TYPE_LABEL[a.appointment_type] ?? "Randevu"}</span>
                          {a.location ? <span className="ml-2 text-xs text-text-muted">{a.location}</span> : null}
                        </span>
                        <span className="shrink-0 text-xs text-text-muted">
                          {longDateTime(a.scheduled_at)} · {APPT_STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="mb-3 flex items-center gap-2.5 font-display font-bold text-ink-950">
              <IconChip icon={History} tone="neutral" size="sm" /> Zaman çizelgesi
            </h2>
            <ActivityTimeline
              events={filterByCategory(allEvents, activeCategory)}
              categories={timelineCategories}
              activeCategory={activeCategory}
              hrefForCategory={(k) => `${timelineBase}${k ? `?kategori=${k}` : ""}`}
              pageSize={timelineLimit}
              loadMoreHref={`${timelineBase}?${activeCategory ? `kategori=${activeCategory}&` : ""}adet=${timelineLimit + 40}`}
              emptyTitle={activeCategory ? "Bu kategoride olay yok." : "Bu talep için henüz olay yok."}
              emptyHint="Talep güncellemeleri ile müşterinin görev, randevu, görüşme ve teklifleri oluştukça burada listelenir."
            />
          </section>
        </div>
      </div>
    </div>
  );
}
