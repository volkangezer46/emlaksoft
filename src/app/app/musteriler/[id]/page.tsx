import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BookUser,
  CalendarDays,
  Mail,
  MapPin,
  MessageCircle,
  PhoneCall,
  Sparkles,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { EditCustomerDialog } from "./edit-customer-dialog";
import { CustomerTagChips } from "./customer-tag-chips";
import { fetchTenantTags } from "../tenant-tags";
import { DeleteCustomerButton } from "./delete-customer-button";
import { Customer360Tabs } from "./customer-360-tabs";
import { CustomerTasks, type CustomerTaskRow } from "./customer-tasks";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { computeLeadScore, leadTierCls } from "@/lib/lead-score";
import { CommunicationTimeline } from "@/components/app/communication-timeline";
import { MatchedPropertiesWidget } from "./matched-properties-widget";
import { fetchTenantMatchingWeights, type MatchProperty } from "@/lib/matching";
import type { TimelineItem } from "./customer-timeline-tab";
import { COMM_CHANNELS } from "@/lib/comm-types";
import { computeNextBestAction } from "./next-best-action";
import { isPast } from "@/lib/clock";
// Ortak tekil SMS dialogu — tek kopya gelen-kutusu'nda yaşar (Yanıtla da onu kullanır)
import { SmsDialog } from "../../gelen-kutusu/sms-dialog";

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

const apptTypeLabel: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

// Zaman tüneli özet etiketleri — ilgili modül sayfalarındaki karşılıklarla aynı
const callDirLabel: Record<string, string> = { inbound: "Gelen", outbound: "Giden", missed: "Cevapsız" };
const apptStatusLabel: Record<string, string> = {
  pending: "Teyit bekliyor",
  confirmed: "Onaylandı",
  signature: "İmza eksik",
  completed: "Tamamlandı",
  cancelled: "İptal",
};
const offerStatusLabel: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};
const contractStatusLabel: Record<string, string> = {
  draft: "Taslak",
  sent: "Gönderildi",
  signed: "İmzalandı",
  rejected: "Reddedildi",
  cancelled: "İptal",
};
const contractTypeLabel: Record<string, string> = {
  satis: "Satış",
  kira: "Kira",
  sozlesme: "Sözleşme",
  teklif: "Teklif",
  diger: "Diğer",
};

function moneyTl(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);
}

function shortDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("customers");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canTaskCreate = (perms.tasks ?? []).includes("create");
  const canTaskEdit = (perms.tasks ?? []).includes("edit");
  const canTaskDelete = (perms.tasks ?? []).includes("delete");
  const canTaskView = (perms.tasks ?? []).includes("view");
  const { id } = await params;
  const supabase = await createClient();

  // Tüm sorgular yalnızca `id`'ye bağlı — müşteri sorgusu da batch'e katıldı (notFound sonra)
  const [
    { data: customer },
    { data: demandsData },
    { data: callsData },
    { data: apptsData },
    { data: provinces },
    { data: auditData },
    { data: dealsData },
    { data: consentsData },
    { data: filesData },
    { data: tasksData },
    { data: commsData },
    { data: offersData },
    { data: contractsData },
    { data: propertiesForMatch },
    matchingWeights,
    tenantTags,
    customerTypeDefs,
    transactionTypeDefs,
    propertyTypeDefs,
    demandUrgencyDefs,
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, email, customer_types, tags, source, notes, blacklist, created_at, province_id, district_id, birth_date, anniversary_date, anniversary_note, province:geo_provinces(name), district:geo_districts(name)")
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
      .from("audit_logs")
      .select("id, action, created_at")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
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
    supabase
      .from("customer_files")
      .select("id, file_name, file_size, file_type, storage_path, label, created_at, uploader:profiles(full_name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, kind, priority, status, due_at, completed_at")
      .eq("customer_id", id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("communications")
      .select("id, channel, direction, subject, body, outcome, duration_sec, scheduled_at, created_at, created_by:profiles(full_name)")
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
    supabase
      .from("contracts")
      .select("id, title, contract_type, status, signed_at, created_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Portföy öneri widget'ı için — sadece aktif portföyler
    supabase
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(100),
    // Ofise özel eşleştirme ağırlıkları — öneri widget'ı eşleştirme sayfasıyla aynı skoru üretsin
    fetchTenantMatchingWeights(supabase),
    // Etiket önerileri — tenant'taki mevcut etiketler (chip input'a prop'la iner)
    fetchTenantTags(supabase),
    getDefinitions("customer_type"),
    getDefinitions("transaction_type"),
    getDefinitions("property_type"),
    getDefinitions("demand_urgency"),
  ]);

  if (!customer) notFound();

  const customerTypeOptions = customerTypeDefs.length ? customerTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;
  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const demandUrgencyOptions = demandUrgencyDefs.length
    ? demandUrgencyDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  const demands = (demandsData ?? []) as Demand[];
  const calls = (callsData ?? []) as Call[];
  const appts = (apptsData ?? []) as Appt[];
  const audit = (auditData ?? []) as { id: string; action: string; created_at: string }[];

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
  const matchProperties = (propertiesForMatch ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];

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
  });
  const score = lead.score;

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
          candidatePropertyCount: matchProperties.length,
          submittedOfferId: submittedOffer?.id ?? null,
          pastAppointmentPending,
        },
        customer.phone ? toTelHref(customer.phone) : null,
      );

  type Activity = {
    key: string;
    title: string;
    sub: string;
    time: string;
    tone: string;
  };

  const activity: Activity[] = [
    ...calls.map((c): Activity => ({
      key: `c-${c.id}`,
      title: c.disposition ?? (c.direction === "missed" ? "Cevapsız çağrı" : "Çağrı"),
      sub: `${formatTurkishPhone(c.phone)}${c.duration_sec ? ` · ${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, "0")}` : ""}`,
      time: c.started_at,
      tone: c.direction === "missed" ? "bg-danger-500/10 text-danger-500" : "bg-brand-600/10 text-brand-600",
    })),
    ...appts.map((a): Activity => ({
      key: `a-${a.id}`,
      title: apptTypeLabel[a.appointment_type] ?? "Randevu",
      sub: a.location ?? "Konum belirtilmedi",
      time: a.scheduled_at,
      tone: "bg-mint-500/12 text-mint-600",
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  /*
   * Zaman tüneli — 4 sekmeye dağılan bilgiyi tek kronolojide birleştirir.
   * Çağrı+randevu aktivite sekmesinin verisini, iletişim kayıtları iletişim
   * sekmesinin verisini yeniden kullanır; yalnız teklif+sözleşme için dar
   * sorgu eklendi. Görevlerden sadece tamamlananlar girer.
   */
  const commRows = (commsData ?? []) as {
    id: string;
    channel: string;
    direction: string;
    subject: string | null;
    body: string | null;
    created_at: string;
  }[];
  const doneTasks = ((tasksData ?? []) as (CustomerTaskRow & { completed_at?: string | null })[])
    .filter((t) => t.status === "done" && (t.completed_at || t.due_at));
  const timeline: TimelineItem[] = [
    ...calls.map((c): TimelineItem => ({
      key: `call-${c.id}`,
      kind: "call",
      title: `${callDirLabel[c.direction] ?? "Çağrı"} çağrı${c.disposition ? ` · ${c.disposition}` : ""}`,
      sub: c.notes || null,
      time: c.started_at,
      href: null,
    })),
    ...appts.map((a): TimelineItem => ({
      key: `appt-${a.id}`,
      kind: "appointment",
      title: `${apptTypeLabel[a.appointment_type] ?? "Randevu"} · ${apptStatusLabel[a.status] ?? a.status}`,
      sub: a.location,
      time: a.scheduled_at,
      href: null,
    })),
    ...(offersData ?? []).map((o): TimelineItem => ({
      key: `offer-${o.id}`,
      kind: "offer",
      title: `Teklif · ${o.amount != null ? moneyTl(Number(o.amount)) : "—"} · ${offerStatusLabel[o.status] ?? o.status}`,
      sub: null,
      time: o.created_at,
      href: `/app/teklifler/${o.id}`,
    })),
    ...(contractsData ?? []).map((c): TimelineItem => ({
      key: `contract-${c.id}`,
      kind: "contract",
      title: `${contractTypeLabel[c.contract_type] ?? "Sözleşme"} sözleşmesi · ${contractStatusLabel[c.status] ?? c.status}`,
      sub: [c.title, c.signed_at ? `İmza: ${shortDate(c.signed_at)}` : null].filter(Boolean).join(" · ") || null,
      time: c.created_at,
      href: `/app/sozlesmeler/${c.id}`,
    })),
    ...doneTasks.map((t): TimelineItem => ({
      key: `task-${t.id}`,
      kind: "task",
      title: `Görev tamamlandı · ${t.title}`,
      sub: null,
      time: (t.completed_at ?? t.due_at) as string,
      href: null,
    })),
    ...commRows.map((c): TimelineItem => ({
      key: `comm-${c.id}`,
      kind: "comm",
      title: `${COMM_CHANNELS.find((ch) => ch.value === c.channel)?.label ?? c.channel}${
        c.direction === "inbound" ? " · Gelen" : c.direction === "outbound" ? " · Giden" : c.direction === "internal" ? " · İç not" : ""
      }`,
      sub: c.subject || c.body || null,
      time: c.created_at,
      href: null,
    })),
    {
      key: "created",
      kind: "created" as const,
      title: "Müşteri kaydı açıldı",
      sub: null,
      time: customer.created_at as string,
      href: null,
    },
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Her kutu ilgili sekmeyi açar (?tab= — Customer360Tabs URL'den okur).
  // Çağrı ve randevu kayıtları aktivite akışında listelenir.
  const stats = [
    { label: "Talep", value: demands.length, icon: Target, tab: "talepler" },
    { label: "Çağrı", value: calls.length, icon: PhoneCall, tab: "aktivite" },
    { label: "Randevu", value: appts.length, icon: CalendarDays, tab: "aktivite" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/app/musteriler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Müşteri merkezine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div className="flex items-start gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-[image:var(--grad-brand)] font-display text-xl font-extrabold text-white shadow-[var(--shadow-glow-brand)]">
              {initials(customer.full_name)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-extrabold text-white md:text-3xl">{customer.full_name}</h1>
                {customer.blacklist ? (
                  <span className="rounded-full bg-danger-500/20 px-2 py-0.5 text-[11px] font-bold text-danger-400">Kara liste</span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${leadTierCls(lead.tier)}`}
                    title={lead.factors.map((f) => `${f.label}: ${f.points > 0 ? "+" : ""}${f.points}`).join(" · ")}
                  >
                    {lead.tier === "hot" ? "🔥" : lead.tier === "warm" ? "🌤️" : "❄️"} {lead.label} · {lead.score}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {types.length > 0 ? (
                  types.map((t) => (
                    <span key={t} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/80">{t}</span>
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
                  <a href={toTelHref(customer.phone) ?? "#"} className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white/90">
                    <PhoneCall className="h-4 w-4" /> Ara
                  </a>
                ) : null}
                {customer.phone ? (
                  <a
                    href={toWhatsAppLink(customer.phone) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                ) : null}
                {customer.phone && canEdit ? (
                  <SmsDialog
                    customerId={customer.id}
                    customerName={customer.full_name}
                    consentGranted={smsConsentGranted}
                  />
                ) : null}
                {/* vCard 3.0 indirme — route: ./vcard/route.ts */}
                <a
                  href={`/app/musteriler/${customer.id}/vcard`}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <BookUser className="h-4 w-4" /> Rehbere ekle (.vcf)
                </a>
                <Link href={`/app/arama?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <PhoneCall className="h-4 w-4" /> Görüşme kaydet
                </Link>
                <Link href={`/app/randevular?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <CalendarDays className="h-4 w-4" /> Randevu ver
                </Link>
                <Link href={`/app/eslestirme?customer=${customer.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
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
                    }}
                    provinces={provinces ?? []}
                    types={customerTypeOptions}
                  />
                ) : null}
                {canDelete ? <DeleteCustomerButton customerId={customer.id} /> : null}
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
                <p className="text-[10px] text-white/55">Müşteri skoru</p>
              </div>
            </div>
            <div className="grid gap-2">
              {stats.map((s) => (
                <Link
                  key={s.label}
                  href={`/app/musteriler/${customer.id}?tab=${s.tab}`}
                  scroll={false}
                  className="focus-ring press group flex items-center gap-2.5 rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 backdrop-blur transition hover:border-brand-300 hover:bg-white/10"
                >
                  <s.icon className="h-4 w-4 text-mint-400" />
                  <span className="font-display text-lg font-extrabold text-white">{s.value}</span>
                  <span className="text-[11px] text-white/50">{s.label}</span>
                  <ArrowUpRight className="hover-action ml-auto h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Sonraki en iyi aksiyon — tek öneri, tek buton; kural eşleşmezse kart yok */}
        {nba ? (
          <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-mint-400/25 bg-white/[0.06] px-4 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-mint-500/15 text-mint-400">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-mint-400">Sonraki en iyi aksiyon</p>
                <p className="truncate text-sm font-semibold text-white">{nba.title}</p>
                <p className="truncate text-[11px] text-white/50">{nba.reason}</p>
              </div>
            </div>
            {nba.externalHref ? (
              <a
                href={nba.externalHref}
                className="btn-shine inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
              >
                <PhoneCall className="h-4 w-4" /> {nba.action}
              </a>
            ) : nba.href ? (
              <Link
                href={nba.href}
                className="btn-shine inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
              >
                {nba.action} <ArrowUpRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <Customer360Tabs
        customerId={customer.id}
        customerName={customer.full_name}
        defaultProvinceId={customer.province_id}
        provinces={provinces ?? []}
        transactionTypes={transactionTypeOptions}
        propertyTypes={propertyTypeOptions}
        urgencyOptions={demandUrgencyOptions}
        demands={demands}
        activity={activity}
        timeline={timeline}
        tags={tags}
        notes={customer.notes}
        source={customer.source}
        createdAt={customer.created_at}
        audit={audit}
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
      />

      {canTaskView ? (
        <CustomerTasks
          customerId={customer.id}
          tasks={(tasksData ?? []) as CustomerTaskRow[]}
          canCreate={canTaskCreate}
          canEdit={canTaskEdit}
          canDelete={canTaskDelete}
        />
      ) : null}

      <MatchedPropertiesWidget
        demands={activeDemands}
        properties={matchProperties}
        weights={matchingWeights}
      />
    </div>
  );
}
