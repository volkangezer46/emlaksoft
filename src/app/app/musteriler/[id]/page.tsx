import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BookUser,
  CalendarDays,
  Mail,
  MapPin,
  MessageSquare,
  PhoneCall,
  Sparkles,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions, getDefinitionsOrDefault, getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import { EditCustomerDialog } from "./edit-customer-dialog";
import { CustomerTagChips } from "./customer-tag-chips";
import { fetchTenantTags } from "../tenant-tags";
import { DeleteCustomerButton } from "./delete-customer-button";
import { Customer360Tabs, CUSTOMER_TAB_IDS, CUSTOMER_TAB_ALIASES } from "./customer-360-tabs";
import { resolveTab } from "@/components/app/detail-tabs";
import { CustomerTasks, type CustomerTaskRow } from "./customer-tasks";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { WaTemplateMenu } from "@/components/app/wa-template-menu";
import { WhatsAppLink } from "@/components/app/whatsapp-link";
import { MoreActions } from "@/components/app/more-actions";
import { HelpTip } from "@/components/ui/help-tip";
import { computeLeadScore, leadTierCls } from "@/lib/lead-score";
import { CommunicationTimeline } from "@/components/app/communication-timeline";
import { MatchedSection, MatchedSkeleton, SatisfactionSection } from "./sections";
import { buildCustomerEvents, CUSTOMER_TIMELINE_CATEGORIES } from "./customer-events";
import { countByCategory, filterByCategory, resolveCategory } from "@/lib/activity-timeline";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { CustomerOwnedListings } from "@/components/app/customer-owned-listings";
import { Wallet } from "lucide-react";
import { computeNextBestAction } from "./next-best-action";
import { isPast, msSince, DAY_MS } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";
import { scoreSellerLikelihood, isOwnerCustomer, hasListingIntent } from "@/lib/seller-prediction";
import { SellerPotentialCard } from "@/components/app/seller-potential-card";
// Ortak tekil SMS dialogu — tek kopya gelen-kutusu'nda yaşar (Yanıtla da onu kullanır)
import { SmsPanel, SmsPanelTrigger } from "../sms-panel";
import { SampleRecordBadge } from "@/components/ui/sample-data-badge";

const RING_C = 2 * Math.PI * 42;

type Rel = { name?: string } | { name?: string }[] | null;

type Demand = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
  created_at: string;
};

type Call = {
  id: string;
  direction: string;
  phone: string;
  duration_sec: number | null;
  disposition: string | null;
  notes: string | null;
  started_at: string;
};

type Appt = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  location: string | null;
  status: string;
};

function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perms, userId, tenantId } = await requireModulePage("customers");
  const stageNames = stageLabelMap(await getStageLabels());
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canTaskCreate = (perms.tasks ?? []).includes("create");
  const canTaskEdit = (perms.tasks ?? []).includes("edit");
  const canTaskDelete = (perms.tasks ?? []).includes("delete");
  const canTaskView = (perms.tasks ?? []).includes("view");
  const { id } = await params;
  // Seçili sekme sunucuda çözülür; yalnız o sekmenin verisi çekilir (eski ?tab= linkleri de çalışır)
  const sp = await searchParams;
  const tab = resolveTab(sp, CUSTOMER_TAB_IDS, "zaman", CUSTOMER_TAB_ALIASES);
  const activeCategory = resolveCategory(sp.kategori, CUSTOMER_TIMELINE_CATEGORIES.map((c) => c.key));
  const rawLimit = Number(Array.isArray(sp.adet) ? sp.adet[0] : sp.adet);
  const timelineLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 40), 400) : 40;
  const supabase = await createClient();
  const noRows = Promise.resolve({ data: null });

  // Tüm sorgular yalnızca `id`'ye bağlı — müşteri sorgusu da batch'e katıldı (notFound sonra)
  const [
    { data: customer },
    { data: demandsData },
    { data: callsData },
    { data: apptsData },
    { data: provinces },
    { data: dealsData },
    { data: consentsData },
    { data: filesData },
    { count: contractsCount },
    { count: filesCount },
    { data: tasksData },
    { data: commsData },
    { data: offersData },
    { data: contractsData },
    { data: matchCandidateIds },
    tenantTags,
    customerTypeDefs,
    transactionTypeDefs,
    propertyTypeDefs,
    demandUrgencyDefs,
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id, is_sample, full_name, phone, email, customer_types, tags, branch_id, assigned_to, source, lead_source, lead_source_detail, notes, blacklist, created_at, province_id, district_id, birth_date, anniversary_date, anniversary_note, is_foreign, nationality, province:geo_provinces(name), district:geo_districts(name)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("customer_demands")
      .select("id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, province_id, district_id, neighborhood_id, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("calls")
      .select("id, direction, phone, duration_sec, disposition, notes, started_at")
      .eq("customer_id", id)
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("appointments")
      .select("id, appointment_type, scheduled_at, location, status")
      .eq("customer_id", id)
      .order("scheduled_at", { ascending: false })
      .limit(50),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase
      .from("deals")
      .select("id, stage, deal_type, deal_value, updated_at")
      .eq("customer_id", id)
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("iys_consents")
      .select("id, channel, status, granted_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    tab === "belgeler"
      ? supabase
          .from("customer_files")
          .select("id, file_name, file_size, file_type, storage_path, label, created_at, uploader:profiles!customer_files_uploaded_by_fkey(full_name)")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })
      : noRows,
    // Sekme sayaçları — yalnız sayı (head), satır çekilmez
    supabase.from("contracts").select("id", { count: "exact", head: true }).eq("customer_id", id),
    supabase.from("customer_files").select("id", { count: "exact", head: true }).eq("customer_id", id),
    supabase
      .from("tasks")
      .select("id, title, kind, priority, status, due_at, completed_at, created_at")
      .eq("customer_id", id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("communications")
      .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles!communications_created_by_fkey(full_name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    // Zaman tüneli sekmesi için dar seçimler (yalnız bu müşteri, son 50)
    supabase
      .from("offers")
      .select("id, amount, status, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    tab === "belgeler"
      ? supabase
          .from("contracts")
          .select("id, title, contract_type, status, signed_at, created_at")
          .eq("customer_id", id)
          .order("created_at", { ascending: false })
          .limit(50)
      : noRows,
    /*
     * "Sonraki en iyi aksiyon" kartı yalnız aday portföy SAYISINI kullanıyor
     * ("N aktif portföy taranabilir"). Eskiden bunun için 100 satır, `features`
     * JSONB'siyle birlikte çekiliyordu — sayfanın en pahalı sorgusu buydu ve
     * künyeyi bekletiyordu. Artık yalnız id'ler geliyor (aynı filtre, aynı
     * limit → aynı sayı); satırların tamamını eşleştirme widget'ı kendi
     * Suspense sınırında çekiyor (bkz. ./sections.tsx).
     */
    supabase
      .from("properties")
      .select("id")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(100),
    // Etiket önerileri — tenant'taki mevcut etiketler (chip input'a prop'la iner)
    fetchTenantTags(supabase),
    getDefinitions("customer_type"),
    getDefinitions("transaction_type"),
    getDefinitions("property_type"),
    getDefinitions("demand_urgency"),
  ]);

  if (!customer) notFound();

  // WhatsApp şablon değişkenleri — {ofis} ve {danisman} için iki hafif sorgu
  const [{ data: waTenant }, { data: waAdvisor }, { data: editBranches }, { data: editAdvisors }, sourceDefs] = await Promise.all([
    supabase.from("tenants").select("name, phone").limit(1).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    // Düzenleme paneli seçenekleri (yalnız düzenleme yetkisi varsa gerekir)
    canEdit ? supabase.from("branches").select("id, name").eq("is_active", true).order("name") : noRows,
    canEdit ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : noRows,
    canEdit ? getDefinitionsOrDefault("customer_source") : Promise.resolve([]),
  ]);

  const customerTypeOptions = customerTypeDefs.length ? customerTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;
  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const demandUrgencyOptions = demandUrgencyDefs.length
    ? demandUrgencyDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  const demands = (demandsData ?? []) as Demand[];
  const calls = (callsData ?? []) as Call[];
  const appts = (apptsData ?? []) as Appt[];

  // Memnuniyet & Paylaşımlar — public link tabanı sunum/anket sayfalarıyla aynı
  const publicBase = getBaseUrl();

  // Portföy öneri widget'ı için
  const activeDemands = demands
    .filter((d) => ["new", "active"].includes(d.status))
    .map((d) => ({
      id: d.id,
      transaction_type: d.transaction_type,
      property_type: d.property_type,
      province_id: d.province_id,
      district_id: null,
      budget_min: d.budget_min != null ? Number(d.budget_min) : null,
      budget_max: d.budget_max != null ? Number(d.budget_max) : null,
      rooms: d.rooms,
      min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null,
      urgency: d.urgency,
      status: d.status,
    }));
  // Yalnız SAYI — satırların tamamını `MatchedSection` çekiyor.
  const matchCandidateCount = (matchCandidateIds ?? []).length;

  // İYS SMS onayı — hero'daki SMS dialogu bu durumla kilitlenir/açılır
  const smsConsentGranted = (consentsData ?? []).some(
    (c) => c.channel === "sms" && c.status === "granted",
  );

  const province = relName(customer.province as Rel);
  const district = relName(customer.district as Rel);
  const types: string[] = customer.customer_types ?? [];
  const tags: string[] = customer.tags ?? [];

  // Lead skoru — mevcut sinyallerden anlık (bkz. lib/lead-score)
  const activeDemandCount = demands.filter((d) => ["new", "active", "matched"].includes(d.status)).length;
  const commsList = (commsData ?? []) as { created_at: string }[];
  const lastActivityAt = [
    ...calls.map((c) => c.started_at),
    ...appts.map((a) => a.scheduled_at),
    ...commsList.map((c) => c.created_at),
  ].filter(Boolean).sort().at(-1) ?? null;
  const lead = computeLeadScore({
    hasPhone: Boolean(customer.phone),
    hasEmail: Boolean(customer.email),
    source: customer.source,
    activeDemands: activeDemandCount,
    communications: commsList.length,
    appointments: appts.length,
    calls: calls.length,
    lastActivityAt,
    createdAt: customer.created_at,
    blacklist: Boolean(customer.blacklist),
    offers: (offersData ?? []).length,
    hasActiveDeal: (dealsData ?? []).some((d) => d.stage !== "won" && d.stage !== "lost"),
  });
  const score = lead.score;

  // Satıcı-tahmini — yalnız malik-tipi müşteride (bkz. lib/seller-prediction)
  const daysAgoOf = (iso: string | null) => (iso ? Math.floor(msSince(iso) / DAY_MS) : null);
  const sellerPrediction = isOwnerCustomer(types)
    ? scoreSellerLikelihood({
        isOwnerType: true,
        daysSinceContact: daysAgoOf(lastActivityAt),
        tenureDays: daysAgoOf(customer.created_at) ?? 0,
        pastWonDeals: (dealsData ?? []).filter((d) => d.stage === "won").length,
        hasListingIntentDemand: hasListingIntent(demands),
      })
    : null;

  // Sonraki en iyi aksiyon — kural motoru, mevcut sayfaverisiyle (bkz. ./next-best-action)
  const submittedOffer = (offersData ?? []).find((o) => o.status === "submitted") ?? null;
  const pastAppointmentPending = appts.some(
    (a) => ["pending", "confirmed"].includes(a.status) && isPast(a.scheduled_at),
  );
  const nba = customer.blacklist
    ? null
    : computeNextBestAction(
        {
          customerId: customer.id,
          leadTier: lead.tier,
          leadLabel: lead.label,
          hasPhone: Boolean(customer.phone),
          lastActivityAt,
          createdAt: customer.created_at,
          openDemandCount: activeDemands.length,
          candidatePropertyCount: matchCandidateCount,
          submittedOfferId: submittedOffer?.id ?? null,
          pastAppointmentPending,
        },
        customer.phone ? toTelHref(customer.phone) : null,
      );

  // Zaman çizelgesi — yalnız o sekme açıkken derlenir; kategori süzgeci sunucuda uygulanır.
  let events: Awaited<ReturnType<typeof buildCustomerEvents>> = [];
  let allEvents: typeof events = [];
  if (tab === "zaman") {
    allEvents = await buildCustomerEvents(supabase, customer.id, customer.created_at as string, {
      calls,
      appts,
      comms: (commsData ?? []) as Parameters<typeof buildCustomerEvents>[3]["comms"],
      offers: (offersData ?? []) as Parameters<typeof buildCustomerEvents>[3]["offers"],
      tasks: canTaskView ? ((tasksData ?? []) as Parameters<typeof buildCustomerEvents>[3]["tasks"]) : [],
      deals: (dealsData ?? []) as Parameters<typeof buildCustomerEvents>[3]["deals"],
      stageNames,
    });
    events = filterByCategory(allEvents, activeCategory);
  }
  const catCounts = countByCategory(allEvents);
  const timelineCategories = CUSTOMER_TIMELINE_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    count: tab === "zaman" ? (catCounts[c.key] ?? 0) : undefined,
  }));
  const timelineLoadMoreHref = `/app/musteriler/${customer.id}?sekme=zaman${activeCategory ? `&kategori=${activeCategory}` : ""}&adet=${timelineLimit + 40}`;

  // KPI şeridi — yalnız gerçek veri; veri yoksa kart gösterilmez. Her kart ilgili sekmeye gider.
  const base = `/app/musteriler/${customer.id}`;
  const completedAppts = appts.filter((a) => a.status === "completed").length;
  const openDeals = (dealsData ?? []).filter((d) => d.stage !== "won" && d.stage !== "lost");
  const openDealSum = openDeals.reduce((n, d) => n + Number(d.deal_value ?? 0), 0);
  const wonDealSum = (dealsData ?? []).filter((d) => d.stage === "won").reduce((n, d) => n + Number(d.deal_value ?? 0), 0);
  const lastOffer = (offersData ?? [])[0] ?? null;
  const tlFmt = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  const amountKpi: { label: string; value: string; hint: string; href: string } | null =
    openDealSum > 0
      ? { label: "Açık anlaşma tutarı", value: tlFmt(openDealSum), hint: `${openDeals.length} açık anlaşma`, href: `${base}?sekme=anlasmalar` }
      : wonDealSum > 0
        ? { label: "Kazanılan tutar", value: tlFmt(wonDealSum), hint: "kapanan anlaşmalar", href: `${base}?sekme=anlasmalar` }
        : lastOffer && lastOffer.amount != null
          ? { label: "Son teklif", value: tlFmt(Number(lastOffer.amount)), hint: `${(offersData ?? []).length} teklif`, href: `${base}?sekme=anlasmalar` }
          : null;
  const lastDays = lastActivityAt ? Math.floor(msSince(lastActivityAt) / DAY_MS) : null;
  const kpis: KpiItem[] = [
    { label: "Açık talep", value: activeDemandCount, href: `${base}?sekme=talepler`, icon: <Target />, tone: "info", hint: `${demands.length} talep kaydı` },
    ...(activeDemands.length > 0
      ? [{ label: "Eşleşme adayı portföy", value: matchCandidateCount, href: `/app/eslestirme?customer=${customer.id}`, icon: <Sparkles />, tone: "success" as const, hint: "aktif portföy havuzu" }]
      : []),
    ...(appts.length > 0
      ? [{ label: "Yapılan randevu", value: completedAppts, href: `${base}?sekme=randevu`, icon: <CalendarDays />, tone: "success" as const, hint: `${appts.length} randevu kaydı` }]
      : []),
    ...(amountKpi ? [{ label: amountKpi.label, value: amountKpi.value, href: amountKpi.href, icon: <Wallet />, tone: "warning" as const, hint: amountKpi.hint }] : []),
    ...(lastDays != null
      ? [{ label: "Son temas", value: lastDays === 0 ? "Bugün" : `${lastDays} gün önce`, href: `${base}?sekme=zaman&kategori=gorusme`, icon: <PhoneCall />, tone: (lastDays > 14 ? "danger" : "neutral") as "danger" | "neutral", hint: "çağrı, randevu ve iletişim kaydı" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Link href="/app/musteriler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Müşteri merkezine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius-panel)] bg-[image:var(--grad-brand)] font-display text-xl font-extrabold text-white shadow-[var(--shadow-glow-brand)]">
              {initials(customer.full_name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-extrabold text-white md:text-3xl">{customer.full_name}</h1>
                <SampleRecordBadge show={customer.is_sample === true} />
                {customer.blacklist ? (
                  <span className="rounded-full bg-danger-500/20 px-2 py-0.5 text-xs font-bold text-danger-400">Kara liste</span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${leadTierCls(lead.tier)}`}
                    title={lead.factors.map((f) => `${f.label}: ${f.points > 0 ? "+" : ""}${f.points}`).join(" · ")}
                  >
                    {lead.tier === "hot" ? "🔥" : lead.tier === "warm" ? "🌤️" : "❄️"} {lead.label} · {lead.score}
                  </span>
                )}
                {customer.blacklist ? null : <HelpTip topic="lead-skoru" label="Aday skoru" />}
                {/* Yabancı uyruklu alıcı — evrak akışı farklı (bkz. /app/yabanci-satis) */}
                {customer.is_foreign ? (
                  <Link
                    href="/app/yabanci-satis"
                    title="Yabancı uyruklu alıcı — zorunlu evraklar ve mevzuat için tıklayın"
                    className="focus-ring inline-flex items-center gap-1 rounded-full bg-mint-500/20 px-2.5 py-0.5 text-xs font-bold text-mint-300 transition hover:bg-mint-500/30"
                  >
                    🌍 Yabancı{customer.nationality ? ` · ${customer.nationality}` : ""}
                  </Link>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {types.length > 0 ? (
                  types.map((t) => (
                    <span key={t} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/80">{t}</span>
                  ))
                ) : (
                  <span className="text-xs text-white/40">Tür belirtilmedi</span>
                )}
              </div>
              {/* Etiket chip'leri + ekleme — tenant önerileri server'dan gelir */}
              <CustomerTagChips
                customerId={customer.id}
                tags={tags}
                suggestions={tenantTags}
                canEdit={canEdit}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-white/70">
                {customer.phone ? (
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <PhoneCall className="h-3.5 w-3.5 text-mint-400" />
                    {formatTurkishPhone(customer.phone)}
                  </span>
                ) : null}
                {customer.email ? (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-cyan-400" />
                    {customer.email}
                  </span>
                ) : null}
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-white/50" />
                  {[district, province].filter(Boolean).join(", ") || "Konum yok"}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {customer.phone ? (
                  <a href={toTelHref(customer.phone) ?? "#"} className="btn-shine inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white/90">
                    <PhoneCall className="h-4 w-4" /> Ara
                  </a>
                ) : null}
                {customer.phone ? (
                  /* Şablonlu WhatsApp — ofis kütüphanesinden metin seçilir, değişkenler dolar */
                  <WaTemplateMenu
                    phone={customer.phone}
                    vars={{
                      musteri: customer.full_name,
                      danisman: waAdvisor?.full_name ?? "",
                      ofis: waTenant?.name ?? "",
                      telefon: waTenant?.phone ?? "",
                    }}
                  />
                ) : null}
                <Link href={`/app/randevular?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <CalendarDays className="h-4 w-4" /> Randevu ver
                </Link>
                <MoreActions>
                {customer.phone ? (
                  <WhatsAppLink
                    phone={customer.phone}
                    message={`Merhaba ${customer.full_name.split(" ")[0]}, ${waTenant?.name ?? "ofisimiz"} adına yazıyorum.`}
                  />
                ) : null}
                {customer.phone && canEdit ? (
                  <SmsPanelTrigger />
                ) : null}
                {/* vCard 3.0 indirme — route: ./vcard/route.ts */}
                <a
                  href={`/app/musteriler/${customer.id}/vcard`}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <BookUser className="h-4 w-4" /> Rehbere ekle (.vcf)
                </a>
                <Link href={`/app/arama?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <PhoneCall className="h-4 w-4" /> Görüşme kaydet
                </Link>
                <Link href={`/app/musteriler/${customer.id}?sekme=iletisim`} scroll={false} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <MessageSquare className="h-4 w-4" /> Not ekle
                </Link>
                <Link href={`/app/eslestirme?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <Target className="h-4 w-4" /> Eşleştir
                </Link>
                {canEdit ? (
                  <EditCustomerDialog
                    customer={{
                      id: customer.id,
                      full_name: customer.full_name,
                      phone: customer.phone,
                      email: customer.email,
                      customer_types: customer.customer_types,
                      province_id: customer.province_id,
                      district_id: customer.district_id,
                      notes: customer.notes,
                      birth_date: customer.birth_date,
                      anniversary_date: customer.anniversary_date,
                      anniversary_note: customer.anniversary_note,
                      branch_id: customer.branch_id,
                      assigned_to: customer.assigned_to,
                      source: customer.source,
                      lead_source_detail: customer.lead_source_detail,
                      blacklist: Boolean(customer.blacklist),
                    }}
                    provinces={provinces ?? []}
                    types={customerTypeOptions}
                    branches={(editBranches ?? []) as { id: string; name: string }[]}
                    advisors={(editAdvisors ?? []) as { id: string; full_name: string }[]}
                    sources={sourceDefs.map((d) => ({ value: d.value, label: d.label }))}
                  />
                ) : null}
                {canDelete ? <DeleteCustomerButton customerId={customer.id} /> : null}
                </MoreActions>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 lg:justify-end">
            <div className="relative grid h-28 w-28 shrink-0 place-items-center">
              <div className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-30 blur-md" style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--brand-500), var(--mint-500))" }} />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--mint-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - score / 100) } as React.CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-2xl font-extrabold text-white">{score}</p>
                <p className="text-xs text-white/55">Müşteri skoru</p>
              </div>
            </div>
          </div>
        </div>

      </section>

      {customer.phone && canEdit ? (
        <SmsPanel customerId={customer.id} customerName={customer.full_name} consentGranted={smsConsentGranted} />
      ) : null}

      <KpiStrip items={kpis} label="Müşteri özeti" />

      {tenantId ? <CustomerOwnedListings tenantId={tenantId} customerId={customer.id} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Customer360Tabs
            customerId={customer.id}
            customerName={customer.full_name}
            defaultProvinceId={customer.province_id}
            provinces={provinces ?? []}
            transactionTypes={transactionTypeOptions}
            propertyTypes={propertyTypeOptions}
            urgencyOptions={demandUrgencyOptions}
            demands={demands}
            events={events}
            timelineCategories={timelineCategories}
            activeCategory={activeCategory}
            timelineLimit={timelineLimit}
            timelineLoadMoreHref={timelineLoadMoreHref}
            appts={appts}
            offers={(offersData ?? []) as { id: string; amount: number | null; status: string; created_at: string }[]}
            contracts={(contractsData ?? []) as { id: string; title: string; status: string; signed_at: string | null; created_at: string }[]}
            tags={tags}
            notes={customer.notes}
            source={customer.source}
            sourceDetail={customer.lead_source_detail}
            createdAt={customer.created_at}
            stageNames={stageNames}
            deals={(dealsData ?? []).map((d) => ({
              id: d.id,
              stage: d.stage,
              deal_type: d.deal_type,
              deal_value: d.deal_value != null ? Number(d.deal_value) : null,
              updated_at: d.updated_at,
            }))}
            consents={consentsData ?? []}
            files={filesData ?? []}
            communications={(commsData ?? []) as Parameters<typeof CommunicationTimeline>[0]["initialItems"]}
            canCreateComm={(perms.customers ?? []).includes("create")}
            active={tab}
            showTasks={canTaskView}
            counts={{
              demands: demands.length,
              comms: commsList.length,
              tasks: (tasksData ?? []).filter((t) => t.status === "open").length,
              deals: (dealsData ?? []).length,
              offers: (offersData ?? []).length,
              appts: appts.length,
              files: filesCount ?? 0,
              contracts: contractsCount ?? 0,
              consents: (consentsData ?? []).length,
            }}
            ozetSlot={
              <>
                {/* Portföy önerileri — yalnız Özet açıkken sorgulanır */}
                <Suspense fallback={<MatchedSkeleton />}>
                  <MatchedSection demands={activeDemands} />
                </Suspense>
                {/* Memnuniyet & Paylaşımlar — anket ve sunum yoksa bileşen kendini gizler,
                    bu yüzden Suspense fallback'i de yok (olmayan bölümün iskeleti çizilmez). */}
                <Suspense fallback={null}>
                  <SatisfactionSection customerId={customer.id} appUrl={publicBase} />
                </Suspense>
              </>
            }
            tasksSlot={
              canTaskView ? (
                <CustomerTasks
                  customerId={customer.id}
                  tasks={(tasksData ?? []) as CustomerTaskRow[]}
                  canCreate={canTaskCreate}
                  canEdit={canTaskEdit}
                  canDelete={canTaskDelete}
                />
              ) : null
            }
          />
        </div>

        {/* Sağ sütun — her sekmede görünür: sonraki en iyi eylem + satıcı potansiyeli */}
        <aside aria-label="Özet ve sonraki eylem" className="space-y-4 lg:sticky lg:top-4">
          {nba ? (
            <section className="rounded-[var(--radius-panel)] border border-mint-500/30 bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-mint-600">
                <Sparkles className="h-3.5 w-3.5" /> Sonraki en iyi eylem
              </p>
              <p className="mt-2 text-sm font-semibold text-ink-950">{nba.title}</p>
              <p className="mt-1 text-xs text-text-muted">{nba.reason}</p>
              {nba.externalHref ? (
                <a
                  href={nba.externalHref}
                  className="btn-shine mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  <PhoneCall className="h-4 w-4" /> {nba.action}
                </a>
              ) : nba.href ? (
                <Link
                  href={nba.href}
                  className="btn-shine mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  {nba.action} <ArrowUpRight className="h-4 w-4" />
                </Link>
              ) : null}
            </section>
          ) : (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Sonraki en iyi eylem</p>
              <p className="mt-2 text-sm text-text-muted">
                {customer.blacklist ? "Kara listedeki müşteri için eylem önerilmez." : "Şu an için önerilen bir eylem yok."}
              </p>
            </section>
          )}
          {sellerPrediction ? <SellerPotentialCard prediction={sellerPrediction} /> : null}
        </aside>
      </div>
    </div>
  );
}
