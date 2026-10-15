import { Suspense } from "react";
import { RadialGauge } from "@/components/ui/viz";
import { CustomFieldsPanel } from "@/components/app/custom-fields-panel";
import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookUser,
  CalendarDays,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
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
import { Customer360Tabs, CUSTOMER_TAB_IDS } from "./customer-360-tabs";
import { customerCtaPermissions } from "./customer-cta-perms";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { resolveTab } from "@/components/app/detail-tabs";
import { CustomerTasks, type CustomerTaskRow } from "./customer-tasks";
import { RentReminderPref } from "./rent-reminder-pref";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { WaTemplateMenu } from "@/components/app/wa-template-menu";
import { WhatsAppLink } from "@/components/app/whatsapp-link";
import { MoreActions } from "@/components/app/more-actions";
import { HelpTip } from "@/components/ui/help-tip";
import { leadTierCls } from "@/lib/customer-state/lead";
import { TEMPERATURE_LABELS } from "@/lib/customer-state/core";
import { loadCustomerStates, prefetchCustomerStateSignals } from "@/lib/customer-state/load";
import { heatBadge, heatTitle, isDigitalFactor } from "@/lib/customer-state/heat";
import { CommunicationTimeline, CustomerQuickNote } from "@/components/app/communication-timeline";
import { loadAssignableAdvisors, type AssignableAdvisor } from "@/lib/team/assignable-roles";
import { MatchedSection, MatchedSkeleton, SatisfactionSection } from "./sections";
import { buildCustomerEvents, CUSTOMER_TIMELINE_CATEGORIES } from "./customer-events";
import { countByCategory, filterByCategory, resolveCategory } from "@/lib/activity-timeline";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { Wallet } from "lucide-react";
import { ReassignAdvisorForm } from "./reassign-advisor-form";
import { NextBestActionIsland, NbaSkeleton, loadNbaSignals, type NbaBaseInput } from "./next-best-action-card";
import type { NbaSignals } from "./next-best-action";
import { ContactPrefsCard } from "./contact-prefs-card";
import {
  CONTACT_PREFS_COLUMNS,
  EMPTY_CONTACT_PREFS,
  contactPrefsFromRow,
  contactPrefsSummary,
  isMissingContactPrefsColumn,
} from "@/lib/customer-contact-prefs";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { MobileRecordActionBar } from "@/components/app/mobile-record-actionbar";
import { RECORD_BAR_CELL, RECORD_BAR_CELL_PRIMARY, RECORD_BAR_ICON } from "@/lib/record-actionbar";
import { UPCOMING_APPOINTMENT_STATUSES } from "@/lib/workflow-state";
import type { MatchDemand } from "@/lib/matching";
import { isPast, msSince, DAY_MS, formatTrTime } from "@/lib/clock";
import { appointmentConfirmUrl } from "@/lib/appointment-messages";
import { formatDateTr } from "@/lib/format";
import { getBaseUrl } from "@/lib/base-url";
import { SellerPotentialCard } from "@/components/app/seller-potential-card";
import { CustomerIntelCard } from "./customer-intel-card";
import { VoiceNoteRecorder } from "@/components/app/voice-note-recorder";
import { OwnedPropertiesCard } from "./owned-properties-card";
import { PortalRequestsCard } from "./portal-requests-card";
// Ortak tekil SMS dialogu — tek kopya gelen-kutusu'nda yaşar (Yanıtla da onu kullanır)
import { provinceOptionsResult } from "@/lib/geo/reader";
import { SmsPanel, SmsPanelTrigger } from "../sms-panel";
import { SampleRecordBadge } from "@/components/ui/sample-data-badge";
import { loadCustomerContacts, loadCustomerNotes, loadCustomerRelations, loadNoteMembers } from "./customer-crm-data";
import { CustomerContactsCard } from "./customer-contacts-card";
import { CustomerRelationsCard } from "./customer-relations-card";
import { CustomerNotesPanel } from "./customer-notes-panel";
import { PinnedNotesStrip } from "./pinned-notes-strip";
import { ContactNumberPicker } from "./contact-number-picker";
import { phoneChoices, whatsappPhone } from "@/lib/customer-contacts";
import { isNoteFilter, type NoteMember } from "@/lib/customer-notes";

export const metadata = { title: "Müşteri" };


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
  criteria: unknown;
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
  confirm_token?: string | null;
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
  // Yetki kapısı + route parametreleri birbirine bağlı değil: tek turda çözülür.
  const [{ perms, userId, tenantId, role }, { id }, sp] = await Promise.all([requireModulePage("customers"), params, searchParams]);
  const canEdit = (perms.customers ?? []).includes("edit");
  // İletişim kaydı/not: createCommunication `customers:create` ister.
  const canCreateComm = (perms.customers ?? []).includes("create");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canTaskCreate = (perms.tasks ?? []).includes("create");
  const canTaskEdit = (perms.tasks ?? []).includes("edit");
  const canTaskDelete = (perms.tasks ?? []).includes("delete");
  const canTaskView = (perms.tasks ?? []).includes("view");
  // Eşleşme ekranı (/app/talepler?sekme=eslesme) talep + eşleşme modülü ister; yoksa sekme talep listesine düşer:
  // "Eşleştir" düğmesi, eşleşme KPI'ı ve eşleşme önerisi yalnız ikisi de açıkken gösterilir.
  const canMatch = effectiveCanAccessModule(perms, "demands") && effectiveCanAccessModule(perms, "matching");
  // Seçili sekme sunucuda çözülür; yalnız o sekmenin verisi çekilir.
  const tab = resolveTab(sp, CUSTOMER_TAB_IDS, "ozet");
  const activeCategory = resolveCategory(sp.kategori, CUSTOMER_TIMELINE_CATEGORIES.map((c) => c.key));
  const rawLimit = Number(Array.isArray(sp.adet) ? sp.adet[0] : sp.adet);
  const timelineLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 40), 400) : 40;
  const supabase = await createClient();
  const noRows = Promise.resolve({ data: null });
  // Müşteri kaydını BEKLEMEDEN başlar (yalnız id gerekir): ısı/aday/randevu sinyalleri künye sorgusuyla aynı turda koşar.
  const stateSignals = prefetchCustomerStateSignals(supabase, tenantId, [id]);
  // Aşama adları yalnız zaman çizelgesi sekmesinde kullanılır; o sekmede toplu turla birlikte okunur.
  const stageNamesP = tab === "gecmis" ? getStageLabels().then(stageLabelMap) : null;

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
    contactPrefsRes,
    tenantTags,
    customerTypeDefs,
    transactionTypeDefs,
    propertyTypeDefs,
    demandUrgencyDefs,
    { data: waTenant },
    { data: waAdvisor },
    { data: editBranches },
    editAdvisors,
    sourceDefs,
    prefRes,
    stageNames,
    contactsRes,
    relationsRes,
    notesRes,
    noteMembers,
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id, is_sample, full_name, phone, email, customer_types, tags, branch_id, assigned_to, source, lead_source, lead_source_detail, notes, blacklist, created_at, province_id, district_id, birth_date, anniversary_date, anniversary_note, is_foreign, nationality, province:geo_provinces(name), district:geo_districts(name)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("customer_demands")
      .select("id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, province_id, district_id, neighborhood_id, criteria, created_at")
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
      .select("id, appointment_type, scheduled_at, location, status, confirm_token")
      .eq("customer_id", id)
      .order("scheduled_at", { ascending: false })
      .limit(50),
    provinceOptionsResult({ includeInactive: true }),
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
    // İletişim tercihi (CRM-G11) ayrı ve hataya dayanıklı: sütunlar yoksa (migration bekliyor) künye düşmez.
    // Gerçek eşleşme SAYISI artık burada değil: "Sonraki en iyi eylem" adası kendi Suspense sınırında hesaplar.
    supabase.from("customers").select(CONTACT_PREFS_COLUMNS).eq("id", id).maybeSingle(),
    // Etiket önerileri — tenant'taki mevcut etiketler (chip input'a prop'la iner)
    fetchTenantTags(supabase),
    getDefinitions("customer_type"),
    getDefinitions("transaction_type"),
    getDefinitions("property_type"),
    getDefinitions("demand_urgency"),
    // WhatsApp şablon değişkenleri — {ofis} ve {danisman} için iki hafif sorgu (yalnız userId'ye bağlı → aynı tur)
    supabase.from("tenants").select("name, phone").limit(1).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    // Düzenleme paneli seçenekleri (yalnız düzenleme yetkisi varsa gerekir)
    canEdit ? supabase.from("branches").select("id, name").eq("is_active", true).order("name") : noRows,
    // Danışman seçicileri yalnız aktif SATIŞ rolleri (B070); takım lideri kendi takımını önde görür.
    canEdit && tenantId ? loadAssignableAdvisors(supabase, tenantId, { userId, role }) : Promise.resolve([] as AssignableAdvisor[]),
    canEdit ? getDefinitionsOrDefault("customer_source") : Promise.resolve([]),
    // Kira hatırlatması tercihi (H3 sütunları): yalnız "özet" sekmesinde; sütun yoksa kart çizilmez (hata yok sayılır).
    tab === "ozet"
      ? supabase.from("customers").select("rent_reminder_opt_out, rent_reminder_opt_out_at").eq("id", id).maybeSingle()
      : Promise.resolve(null),
    stageNamesP ?? Promise.resolve({} as ReturnType<typeof stageLabelMap>),
    // CRM derinliği (G7/G8/G9): ek numaralar (hero seçicisi her sekmede), ilişkili kişiler, notlar (sabit şerit her
    // sekmede) ve @anma için ekip listesi (yalnız Özet'te ve not yazma yetkisiyle). Hepsi tablo yoksa boş döner.
    loadCustomerContacts(supabase, id),
    loadCustomerRelations(supabase, id),
    loadCustomerNotes(supabase, id),
    tab === "ozet" && canCreateComm ? loadNoteMembers(supabase, tenantId) : Promise.resolve([] as NoteMember[]),
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

  // Memnuniyet & Paylaşımlar — public link tabanı sunum/anket sayfalarıyla aynı
  const publicBase = getBaseUrl();

  // WhatsApp şablonlarının {randevu_tarih}/{randevu_saat}/{teyit_linki} değişkenleri: en yakın gelecek randevu (TR saati) ve
  // teyit bağlantısı. Genel `{link}` (ilan vitrin bağlantısı) EZİLMEZ; `{adres}` randevu yeriyle yalnız randevu şablonlarında dolar. Liste tarihe göre azalan geldiği için gelecekteki en erken randevu, geçmiş olmayanların sonuncusudur.
  const nextAppt = appts.filter((a) => (a.status === "pending" || a.status === "confirmed") && !isPast(a.scheduled_at)).at(-1) ?? null;
  const nextApptVars = nextAppt
    ? {
        randevu_tarih: formatDateTr(nextAppt.scheduled_at, { day: "numeric", month: "long", weekday: "long" }),
        randevu_saat: formatTrTime(nextAppt.scheduled_at),
        teyit_linki: appointmentConfirmUrl(publicBase, nextAppt.confirm_token) ?? "",
      }
    : {};
  const nextApptCategoryVars = nextAppt?.location ? { randevu: { adres: nextAppt.location } } : undefined;

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
  // Gerçek eşleşme sayısı için TAM talep (mahalle, ilçe, ek kriterler dahil) — Talepler > Eşleşme ile aynı skorlayıcı.
  const openDemandsFull: MatchDemand[] = demands
    .filter((d) => d.status === "new" || d.status === "active")
    .map((d) => ({
      id: d.id,
      transaction_type: d.transaction_type,
      property_type: d.property_type,
      province_id: d.province_id,
      district_id: d.district_id,
      neighborhood_id: d.neighborhood_id,
      budget_min: d.budget_min != null ? Number(d.budget_min) : null,
      budget_max: d.budget_max != null ? Number(d.budget_max) : null,
      rooms: d.rooms,
      min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null,
      urgency: d.urgency,
      status: d.status,
      criteria: d.criteria,
    }));
  // Akan sinyaller (gerçek eşleşme sayısı + sunum/portal ilgisi): BEKLENMEZ; NBA adası ve KPI şeridi kendi sınırında okur.
  const nbaSignalsP: Promise<NbaSignals> = customer.blacklist
    ? Promise.resolve({ matchCount: null, presentationViewedAt: null, pendingPortalRequests: 0 })
    : loadNbaSignals(supabase, { tenantId, customerId: customer.id, demands: openDemandsFull, canMatch });

  // İletişim tercihi (CRM-G11): sütun yoksa kart "kurulum bekliyor" der; tercih uydurulmaz.
  const contactPrefsAvailable = !contactPrefsRes.error || !isMissingContactPrefsColumn(contactPrefsRes.error);
  const contactPrefs = contactPrefsRes.error
    ? EMPTY_CONTACT_PREFS
    : contactPrefsFromRow(contactPrefsRes.data as Record<string, unknown> | null);
  const contactPrefsBadge = contactPrefsSummary(contactPrefs);

  // İYS SMS onayı — hero'daki SMS dialogu bu durumla kilitlenir/açılır
  const smsConsentGranted = (consentsData ?? []).some(
    (c) => c.channel === "sms" && c.status === "granted",
  );

  const province = relName(customer.province as Rel);
  const district = relName(customer.district as Rel);
  const types: string[] = customer.customer_types ?? [];
  const tags: string[] = customer.tags ?? [];

  // Sıcaklık / risk / aday / satıcı: TEK okuyucu (lib/customer-state) — liste ve Akıllı Listelerle aynı sonuç.
  const activeDemandCount = demands.filter((d) => ["new", "active", "matched"].includes(d.status)).length;
  const commsList = (commsData ?? []) as { created_at: string }[];
  const lastActivityAt = [
    ...calls.map((c) => c.started_at),
    ...appts.map((a) => a.scheduled_at),
    ...commsList.map((c) => c.created_at),
  ].filter(Boolean).sort().at(-1) ?? null;
  const state = (await loadCustomerStates(
    supabase,
    tenantId,
    [{
      id: customer.id,
      created_at: customer.created_at,
      blacklist: customer.blacklist,
      phone: customer.phone,
      email: customer.email,
      source: customer.source,
      customer_types: types,
    }],
    { context: "Müşteri 360", prefetched: stateSignals },
  )).get(customer.id)!;
  const lead = state.scores.lead;
  // Isıyı oluşturan kalemler (çip): yalnız pozitif ısı faktörleri, en çok 5; dijital ilgi (sunum/portal) vurgulu.
  const heatChips = state.reasons
    .filter((r) => r.evidence.endsWith("sıcaklık puanı"))
    .slice(0, 5)
    .map((r) => ({ label: r.label, evidence: r.evidence.replace(" sıcaklık puanı", ""), href: r.href, digital: isDigitalFactor(r.label) }));
  const score = lead.score;
  const sellerPrediction = state.scores.seller;

  // Sonraki en iyi aksiyon — kural motoru, mevcut sayfaverisiyle (bkz. ./next-best-action)
  const submittedOffer = (offersData ?? []).find((o) => o.status === "submitted") ?? null;
  const pastAppointmentPending = appts.some(
    (a) => (UPCOMING_APPOINTMENT_STATUSES as readonly string[]).includes(a.status) && isPast(a.scheduled_at),
  );
  const telHref = customer.phone ? toTelHref(customer.phone) : null;
  const firstName = customer.full_name.split(/\s+/)[0] ?? customer.full_name;
  const waGreeting = `Merhaba ${firstName}, ${waTenant?.name ?? "ofisimiz"} adına yazıyorum.`;
  // Ek numaralar (CRM-G7): WhatsApp varsayılanı "WhatsApp" etiketli numara; birden çok numarada hero'da seçici.
  const contacts = contactsRes.data;
  const numberChoices = phoneChoices(customer.phone, contacts);
  const waPhone = whatsappPhone(customer.phone, contacts);
  const extraEmails = contacts.filter((c) => c.kind === "email").length;
  const waHref = buildWhatsAppLink(waPhone, waGreeting);
  const phone = waPhone;
  const nbaBase: NbaBaseInput = {
    customerId: customer.id,
    firstName,
    leadTier: state.temperature === "sicak" ? "hot" : state.temperature === "ilik" ? "warm" : "cold",
    leadLabel: TEMPERATURE_LABELS[state.temperature],
    telHref,
    waHref,
    waMessageHref: (message: string) => buildWhatsAppLink(phone, message),
    email: customer.email,
    lastActivityAt,
    createdAt: customer.created_at,
    hasAnyContact: calls.length > 0 || commsList.length > 0 || appts.length > 0,
    openDemands: demands
      .filter((d) => d.status === "new" || d.status === "active")
      .map((d) => ({
        id: d.id,
        created_at: d.created_at,
        label: [d.property_type, d.transaction_type].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR"),
      })),
    canMatch,
    submittedOfferId: submittedOffer?.id ?? null,
    pastAppointmentPending,
    birthDate: customer.birth_date ?? null,
    anniversaryDate: customer.anniversary_date ?? null,
    prefs: contactPrefs,
  };

  // Kira hatırlatması tercihi (H3 sütunları): yalnız "İletişim tercihleri" sekmesinde; sütun yoksa kart çizilmez.
  let rentPref: { optOut: boolean; atLabel: string | null } | null = null;
  if (tab === "ozet") {
    if (prefRes && !prefRes.error && prefRes.data) {
      const row = prefRes.data as { rent_reminder_opt_out?: boolean | null; rent_reminder_opt_out_at?: string | null };
      rentPref = {
        optOut: row.rent_reminder_opt_out === true,
        atLabel: row.rent_reminder_opt_out_at
          ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" }).format(new Date(row.rent_reminder_opt_out_at))
          : null,
      };
    }
  }

  // Zaman çizelgesi — yalnız o sekme açıkken derlenir; kategori süzgeci sunucuda uygulanır.
  let events: Awaited<ReturnType<typeof buildCustomerEvents>> = [];
  let allEvents: typeof events = [];
  if (tab === "gecmis") {
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
    count: tab === "gecmis" ? (catCounts[c.key] ?? 0) : undefined,
  }));
  const timelineLoadMoreHref = `/app/musteriler/${customer.id}?sekme=gecmis${activeCategory ? `&kategori=${activeCategory}` : ""}&adet=${timelineLimit + 40}`;

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
      ? { label: "Açık anlaşma tutarı", value: tlFmt(openDealSum), hint: `${openDeals.length} açık anlaşma`, href: `${base}?sekme=ozet` }
      : wonDealSum > 0
        ? { label: "Kazanılan tutar", value: tlFmt(wonDealSum), hint: "kapanan anlaşmalar", href: `${base}?sekme=ozet` }
        : lastOffer && lastOffer.amount != null
          ? { label: "Son teklif", value: tlFmt(Number(lastOffer.amount)), hint: `${(offersData ?? []).length} teklif`, href: `${base}?sekme=ozet` }
          : null;
  const lastDays = lastActivityAt ? Math.floor(msSince(lastActivityAt) / DAY_MS) : null;
  // Eşleşme KPI'ı GERÇEK sayıdır (akışla gelir); şerit önce "…" ile çizilir, sayı gelince tamamlanır.
  const showMatchKpi = activeDemands.length > 0 && canMatch;
  const matchKpi = (value: number | string, hint: string): KpiItem => ({
    label: "Uygun portföy",
    value,
    href: `/app/talepler?sekme=eslesme&customer=${customer.id}`,
    icon: <Sparkles />,
    tone: "success",
    hint,
  });
  const kpisWith = (match: KpiItem | null): KpiItem[] => [
    { label: "Açık talep", value: activeDemandCount, href: `${base}?sekme=talepler`, icon: <Target />, tone: "info", hint: `${demands.length} talep kaydı` },
    ...(match ? [match] : []),
    ...(appts.length > 0
      ? [{ label: "Yapılan randevu", value: completedAppts, href: `${base}?sekme=ozet`, icon: <CalendarDays />, tone: "success" as const, hint: `${appts.length} randevu kaydı` }]
      : []),
    ...(amountKpi ? [{ label: amountKpi.label, value: amountKpi.value, href: amountKpi.href, icon: <Wallet />, tone: "warning" as const, hint: amountKpi.hint }] : []),
    ...(lastDays != null
      ? [{ label: "Son temas", value: lastDays === 0 ? "Bugün" : `${lastDays} gün önce`, href: `${base}?sekme=gecmis&kategori=gorusme`, icon: <PhoneCall />, tone: (lastDays > 14 ? "danger" : "neutral") as "danger" | "neutral", hint: "çağrı, randevu ve iletişim kaydı" }]
      : []),
  ];
  const kpiFallback = kpisWith(showMatchKpi ? matchKpi("…", "hesaplanıyor") : null);

  // Hero eylem düğmeleri: dokunmatikte ≥44 px (touch:min-h-11).
  const heroBtn =
    "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10 touch:min-h-11";
  const matchHref = `/app/talepler?sekme=eslesme&customer=${customer.id}`;
  const showMatchPrimary = canMatch && activeDemands.length > 0;

  return (
    // Mobil (< lg) sıralama: künye → sonraki en iyi eylem → sesli not → KPI → sekmeler → diğer kartlar.
    // Masaüstünde grid yerleşimi aynı: sekmeler solda, NBA ve özet kartları sağ sütunda (tek render, CSS order/grid).
    <div className="flex flex-col gap-6">
      <Link href="/app/musteriler" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-text-muted transition hover:text-brand-600 max-lg:order-[-3] touch:min-h-11">
        <ArrowLeft className="h-4 w-4" /> Müşteri merkezine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-4 text-white max-lg:order-[-3] md:p-6">
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
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${leadTierCls(state.temperature === "sicak" ? "hot" : state.temperature === "ilik" ? "warm" : "cold")}`}
                    title={`${heatTitle(state.scores.heat)}
Aday skoru ${lead.score} (ayrı ölçek): ${lead.factors.map((f) => `${f.label}: ${f.points > 0 ? "+" : ""}${f.points}`).join(" · ")}`}
                  >
                    {/* Tek dil + tek sayı: liste satırı ve Müşteri sıcaklığı kartıyla aynı `heatBadge` metni (YD5). */}
                    <span aria-hidden>{heatBadge(state.scores.heat).emoji}</span> {heatBadge(state.scores.heat).text}
                  </span>
                )}
                {customer.blacklist || state.risk !== "yuksek" ? null : (
                  <span className="rounded-full bg-danger-500/20 px-2 py-0.5 text-xs font-bold text-danger-400" title={state.reasons[0] ? `${state.reasons[0].label}: ${state.reasons[0].evidence}` : "Kayıp riski yüksek"}>
                    Yüksek risk
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
                {/* İletişim tercihi rozeti (CRM-G11) — kartına gider */}
                {contactPrefsBadge ? (
                  <Link
                    href={`${base}?sekme=ozet#iletisim-tercihi`}
                    title="İletişim tercihi — değiştirmek için tıklayın"
                    className="focus-ring inline-flex items-center gap-1 rounded-full bg-cyan-400/15 px-2.5 py-0.5 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/25"
                  >
                    <MessagesSquare className="h-3 w-3" aria-hidden /> {contactPrefsBadge}
                  </Link>
                ) : null}
              </div>
              {customer.blacklist ? null : (
                /* Rozet/skor tek cümleyle açıklanır + tek eylem (lib/customer-state nedenleri; sahte/açıklamasız sayı yok). */
                <p className="mt-2 max-w-xl text-sm text-white/75">
                  {heatBadge(state.scores.heat).label}:{" "}
                  {state.reasons[0]
                    ? `${state.reasons[0].label} (${state.reasons[0].evidence}).`
                    : state.daysSinceContact !== null
                      ? `son temas ${state.daysSinceContact} gün önce.`
                      : "henüz temas kaydı yok."}
                  {state.nextBestAction ? (
                    <>
                      {" "}
                      <Link href={state.nextBestAction.href} className="focus-ring rounded font-semibold text-white underline underline-offset-2 hover:text-mint-300">
                        {state.nextBestAction.text}
                      </Link>
                    </>
                  ) : null}
                </p>
              )}
              {/* Sıcaklığın açıklama çipleri (CRM-G10): ısıyı oluşturan kalemler; her çip kanıta götürür. */}
              {customer.blacklist || heatChips.length === 0 ? null : (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sıcaklığı oluşturan sinyaller">
                  {heatChips.map((c) => (
                    <li key={c.label}>
                      <Link
                        href={c.href}
                        className={`focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition touch:min-h-11 ${c.digital ? "bg-mint-500/20 text-mint-200 hover:bg-mint-500/30" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                      >
                        {c.label} <span className="tabular-nums text-white/60">{c.evidence}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
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
                    {numberChoices.length > 1 ? (
                      <a href="#iletisim-bilgileri" className="focus-ring rounded-full bg-white/10 px-1.5 text-xs font-semibold text-white/80 hover:bg-white/20" title="Tüm numaralar">
                        +{numberChoices.length - 1}
                      </a>
                    ) : null}
                  </span>
                ) : null}
                {customer.email ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{customer.email}</span>
                    {extraEmails > 0 ? (
                      <a href="#iletisim-bilgileri" className="focus-ring shrink-0 rounded-full bg-white/10 px-1.5 text-xs font-semibold text-white/80 hover:bg-white/20" title="Tüm e-postalar">
                        +{extraEmails}
                      </a>
                    ) : null}
                  </span>
                ) : null}
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-white/50" />
                  {[district, province].filter(Boolean).join(", ") || "Konum yok"}
                </span>
              </div>
              {/* Sık eylemler satırda (Ara · WhatsApp · Not · Randevu · Eşleştir); seyrek olanlar "Daha fazla" içinde.
                  Bu satır ekrandan çıkınca mobil eylem çubuğu belirir (id ile izlenir). */}
              <div id="musteri-eylemleri" className="mt-4 flex flex-wrap gap-2">
                {telHref ? (
                  <a href={telHref} className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950 transition hover:bg-white/90 touch:min-h-11">
                    <PhoneCall className="h-4 w-4" /> Ara
                  </a>
                ) : null}
                {/* Birden çok numara: hangi numaradan aranacağı / yazılacağı seçilir (CRM-G7). */}
                <ContactNumberPicker choices={numberChoices} greeting={waGreeting} />
                {waPhone ? (
                  /* Şablonlu WhatsApp — ofis kütüphanesinden metin seçilir, değişkenler dolar */
                  <WaTemplateMenu
                    phone={waPhone}
                    vars={{
                      musteri: customer.full_name,
                      danisman: waAdvisor?.full_name ?? "",
                      ofis: waTenant?.name ?? "",
                      telefon: waTenant?.phone ?? "",
                      ...nextApptVars,
                    }}
                    categoryVars={nextApptCategoryVars}
                  />
                ) : null}
                {canCreateComm ? (
                  // B054: sekme turu yerine satır içi panel (tek alan + Kaydet); not Notlar kartında iyimser görünür.
                  <CustomerQuickNote
                    customerId={customer.id}
                    className="h-auto gap-1.5 border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-white hover:bg-white/10 hover:text-white touch:min-h-11"
                  />
                ) : null}
                <Link href={`/app/randevular?customer=${customer.id}`} className={heroBtn}>
                  <CalendarDays className="h-4 w-4" /> Randevu ver
                </Link>
                {showMatchPrimary ? (
                  <Link href={matchHref} className={heroBtn}>
                    <Target className="h-4 w-4" /> Eşleştir
                  </Link>
                ) : null}
                <MoreActions>
                {waPhone ? (
                  <WhatsAppLink phone={waPhone} message={waGreeting} />
                ) : null}
                {customer.phone && canEdit ? (
                  <SmsPanelTrigger />
                ) : null}
                {/* vCard 3.0 indirme — route: ./vcard/route.ts */}
                <a href={`/app/musteriler/${customer.id}/vcard`} className={heroBtn}>
                  <BookUser className="h-4 w-4" /> Rehbere ekle (.vcf)
                </a>
                <Link href={`/app/gelen-kutusu?sekme=cagri&customer=${customer.id}`} className={heroBtn}>
                  <PhoneCall className="h-4 w-4" /> Görüşme kaydet
                </Link>
                {canMatch && !showMatchPrimary ? (
                  <Link href={matchHref} className={heroBtn}>
                    <Target className="h-4 w-4" /> Eşleştir
                  </Link>
                ) : null}
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
                    advisors={editAdvisors}
                    sources={sourceDefs.map((d) => ({ value: d.value, label: d.label }))}
                  />
                ) : null}
                {canEdit && editAdvisors.length > 0 ? (
                  // key: sunucudaki atama değişince seçici yeni değerle yeniden bağlanır (B063).
                  <ReassignAdvisorForm key={customer.assigned_to ?? "yok"} customerId={customer.id} current={customer.assigned_to} advisors={editAdvisors} />
                ) : null}
                {canDelete ? <DeleteCustomerButton customerId={customer.id} /> : null}
                </MoreActions>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 lg:justify-end">
            <div className="relative grid h-28 w-28 shrink-0 place-items-center">
              <div className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-30 blur-md" style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--brand-500), var(--mint-500))" }} />
              <RadialGauge
                value={score}
                max={100}
                size={112}
                stroke={9}
                color="var(--mint-400)"
                trackColor="var(--viz-track-inverse)"
                ariaLabel="Müşteri skoru"
                className="absolute inset-0"
              />
              <div className="absolute text-center">
                <p className="font-display text-2xl font-extrabold text-white">{score}</p>
                <p className="text-xs text-white/55" title="Alıcı adayının ne kadar ciddi göründüğü (0-100); iletişim, talep ve randevu hareketlerinden hesaplanır.">Aday puanı</p>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* Sabit notlar (CRM-G9): her sekmede künyenin hemen altında. */}
      <div className="max-lg:order-[-3] empty:hidden">
        <PinnedNotesStrip customerId={customer.id} notes={notesRes.data} />
      </div>

      {customer.phone && canEdit ? (
        <SmsPanel customerId={customer.id} customerName={customer.full_name} consentGranted={smsConsentGranted} />
      ) : null}

      {/* KPI şeridi: "Uygun portföy" GERÇEK eşleşme sayısıdır ve akışla gelir; önce "…" ile çizilir (kayma yok). */}
      {showMatchKpi ? (
        <Suspense fallback={<KpiStrip items={kpiFallback} label="Müşteri özeti" />}>
          <StreamedKpiStrip signals={nbaSignalsP} build={(m) => kpisWith(m === null ? matchKpi("—", "hesaplanamadı") : matchKpi(`${m.count}${m.truncated ? "+" : ""}`, "açık talebe uyan (puan ≥ 35)"))} />
        </Suspense>
      ) : (
        <KpiStrip items={kpisWith(null)} label="Müşteri özeti" />
      )}

      {tenantId ? (
        <Suspense fallback={null}>
          <CustomFieldsPanel entity="customer" recordId={customer.id} tenantId={tenantId} canEdit={canEdit} canManage={(perms.settings ?? []).includes("edit")} />
        </Suspense>
      ) : null}

      {/* < lg: `contents` — çocuklar dış sütuna katılır ve order ile dizilir; lg+: iki sütunlu grid. */}
      <div className="grid items-start gap-6 max-lg:contents lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Sonraki en iyi eylem — mobilde künyenin hemen altında, masaüstünde sağ sütunun başında */}
        <div className="max-lg:order-[-2] lg:col-start-2 lg:row-start-1">
          <Suspense fallback={<NbaSkeleton />}>
            <NextBestActionIsland base={nbaBase} signals={nbaSignalsP} blacklist={Boolean(customer.blacklist)} />
          </Suspense>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
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
            canCreateComm={canCreateComm}
            can={customerCtaPermissions(perms)}
            active={tab}
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
                {/* Portaldan gelen arayış güncelleme isteği (bekleyen yoksa çizilmez) */}
                {tenantId ? (
                  <Suspense fallback={null}>
                    <PortalRequestsCard customerId={customer.id} tenantId={tenantId} canEdit={canEdit} />
                  </Suspense>
                ) : null}
                {/* Portföy önerileri — yalnız Özet açıkken sorgulanır */}
                <Suspense fallback={<MatchedSkeleton />}>
                  <MatchedSection demands={activeDemands} customerId={customer.id} />
                </Suspense>
                {/* Memnuniyet & Paylaşımlar — anket ve sunum yoksa bileşen kendini gizler,
                    bu yüzden Suspense fallback'i de yok (olmayan bölümün iskeleti çizilmez). */}
                <Suspense fallback={null}>
                  <SatisfactionSection customerId={customer.id} appUrl={publicBase} />
                </Suspense>
              </>
            }
            preferencesSlot={
              tab === "ozet" ? (
                <>
                  <ContactPrefsCard
                    customerId={customer.id}
                    initial={contactPrefs}
                    available={contactPrefsAvailable}
                    canEdit={canEdit}
                  />
                  {rentPref ? (
                    <RentReminderPref
                      customerId={customer.id}
                      optOut={rentPref.optOut}
                      optOutAtLabel={rentPref.atLabel}
                      canEdit={canEdit}
                    />
                  ) : null}
                </>
              ) : null
            }
            notesSlot={
              tab === "ozet" ? (
                <CustomerNotesPanel
                  customerId={customer.id}
                  notes={notesRes.data}
                  members={noteMembers}
                  userId={userId}
                  canCreate={canCreateComm}
                  canPin={canEdit}
                  pinAvailable={notesRes.available}
                  generalNote={customer.notes}
                  initialFilter={isNoteFilter(sp.notlar) ? sp.notlar : "tum"}
                />
              ) : null
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

        {/* Sağ sütun (lg+) — her sekmede görünür. Mobilde `contents`: sesli not NBA'nın hemen altına çıkar, diğerleri sona. */}
        <aside aria-label="Özet kartları" className="max-lg:contents lg:sticky lg:top-4 lg:col-start-2 lg:row-start-2 lg:space-y-4">
          <div className="max-lg:order-[-2]">
            <VoiceNoteRecorder kind="customer" id={customer.id} />
          </div>
          <CustomerContactsCard
            customerId={customer.id}
            firstName={firstName}
            phone={customer.phone}
            email={customer.email}
            contacts={contacts}
            available={contactsRes.available}
            canEdit={canEdit}
          />
          <CustomerRelationsCard
            customerId={customer.id}
            customerName={customer.full_name}
            relations={relationsRes.data}
            available={relationsRes.available}
            canEdit={canEdit}
          />
          {sellerPrediction ? <SellerPotentialCard prediction={sellerPrediction} /> : null}
          <OwnedPropertiesCard customerId={customer.id} tenantId={tenantId} />
          <CustomerIntelCard
            customerId={customer.id}
            heat={state.scores.heat}
            createdAt={customer.created_at}
            blacklist={Boolean(customer.blacklist)}
            comms={(commsData ?? []) as { channel: string; direction: string; created_at: string }[]}
            calls={calls}
            openDemands={activeDemandCount}
            hasOpenOfferOrDeal={(dealsData ?? []).some((d) => d.stage !== "won" && d.stage !== "lost") || (offersData ?? []).some((o) => o.status === "submitted")}
          />
        </aside>
      </div>

      {/* Mobil eylem çubuğu (MP6): künyedeki eylem satırı ekrandan çıkınca alt gezinmenin üstünde belirir. */}
      <MobileRecordActionBar watchId="musteri-eylemleri" label="Müşteri hızlı eylemleri">
        {telHref ? (
          <a href={telHref} className={RECORD_BAR_CELL_PRIMARY}>
            <PhoneCall className={RECORD_BAR_ICON} aria-hidden /> Ara
          </a>
        ) : null}
        {waHref ? (
          <a href={waHref} target="_blank" rel="noopener noreferrer" className={RECORD_BAR_CELL} aria-label="WhatsApp'tan yaz (yeni sekmede açılır)">
            <MessageCircle className={RECORD_BAR_ICON} aria-hidden /> WhatsApp
          </a>
        ) : null}
        {canCreateComm ? (
          <CustomerQuickNote customerId={customer.id} className={`${RECORD_BAR_CELL} h-auto`} />
        ) : null}
        <Link href={`/app/randevular?customer=${customer.id}`} className={RECORD_BAR_CELL}>
          <CalendarDays className={RECORD_BAR_ICON} aria-hidden /> Randevu
        </Link>
      </MobileRecordActionBar>
    </div>
  );
}

/** KPI şeridi — gerçek eşleşme sayısı gelince tamamlanır (sinyal sözü NBA adasıyla ortak; tek sorgu turu). */
async function StreamedKpiStrip({
  signals,
  build,
}: {
  signals: Promise<NbaSignals>;
  build: (match: { count: number; truncated: boolean } | null) => KpiItem[];
}) {
  const s = await signals;
  return <KpiStrip items={build(s.matchCount === null ? null : { count: s.matchCount, truncated: s.matchTruncated === true })} label="Müşteri özeti" />;
}
