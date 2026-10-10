import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock3,
  FileSignature,
  MapPinned,
  PieChart,
  Plus,
  Route as RouteIcon,
  Search,
  Hourglass,
} from "lucide-react";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ColumnChartCard, DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { resolveLazyTotal } from "@/lib/lazy-total";
import { requireModulePage } from "@/lib/require-module-page";
import { calendarDateToTrIso, formatTrTime, now, trDayKey, trTodayCalendarDate } from "@/lib/clock";
import { APPOINTMENT_OUTCOME_META, isAppointmentOutcome } from "@/lib/appointment-outcome";
import { getDefinitions } from "@/lib/definitions";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentWeekView, type WeekViewAppointment } from "./appointment-week-view";
import { RouteSuggestion, type RouteStop } from "./route-suggestion";
import { RotaView, type RotaAdvisor, type RotaDurak } from "./rota-view";
import { buildRoutePlan, type RoutePlanStop, directionsHref as directionsHrefFor } from "@/lib/route-plan";
import { ExportIcsButton } from "./export-ics-button";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { CalendarSubscribeCard } from "./calendar-subscribe-card";
import { BookingLinkCard } from "./booking-link-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TR_OFFSET_MIN } from "@/lib/booking-slots";
import { isOnLeave, type LeaveLike } from "@/lib/leave-utils";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { ICONS } from "@/lib/icons";
import { relatedSearchClause } from "@/lib/list-search";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  buildActiveChips,
  densityOf,
  pageWindow,
  parsePage,
  uuidParam,
  type KpiItem,
  type ViewOption,
} from "@/components/ui/list-kit";
import { MANAGEMENT_TIER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { AppointmentTable, type AppointmentVM } from "./appointment-rows";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  CUSTOMER_RESPONSE_META,
  FILTERABLE_STATUSES,
  OUTCOME_TONE,
  appointmentStatusTone,
  appointmentTypeTone,
  needsFollowUp,
  sumCounts,
} from "./appointment-list-logic";

export const metadata = { title: "Randevular" };

const PATH = "/app/randevular";

type RelRow = { id?: string; full_name?: string; title?: string; property_code?: string; lat?: number | null; lng?: number | null };
type Rel = RelRow | RelRow[] | null;

type AppointmentRow = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  duration_min: number | null;
  location: string | null;
  status: string;
  notes: string | null;
  confirm_token: string | null;
  customer_response: string | null;
  /** İzin ipucu için gerekli — randevunun danışmanı. */
  assigned_to: string | null;
  /** Danışmanın randevu değerlendirmesi (migration 126) — eşleştirme geri bildirimi DEĞİL. */
  outcome: string | null;
  outcome_note: string | null;
  /** Gösterim belgesi imzalandı (randevu teyit sayfasında imza). */
  signed_at?: string | null;
  customer: Rel;
  property: Rel;
};

const typeLabel = APPOINTMENT_TYPE_LABELS;

/** Rota görünümü rozeti için (istemci bileşeni sınıf bekler). */
const typeTone: Record<string, string> = {
  showing: "bg-brand-600/10 text-brand-600",
  office: "bg-cyan-400/12 text-cyan-500",
  valuation: "bg-amber-400/15 text-amber-500",
  contract: "bg-mint-500/12 text-mint-600",
};

function rel(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Liste (tablo) sayfa boyutu — pencere içindeki randevular bellekte sayfalanır (en çok APPT_LIMIT). */
const PAGE_SIZE = 50;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    tip?: string;
    durum?: string;
    customer?: string;
    property?: string;
    gorunum?: string;
    tarih?: string;
    gun?: string;
    danisman?: string;
    sube?: string;
    sayfa?: string;
    yogunluk?: string;
    yeni?: string;
  }>;
}) {
  const gate = await requireModulePage("appointments");
  const supabase = await createClient();
  const sp = (await searchParams) ?? {};
  const savedViewsPromise = listSavedViews(PATH);
  // Eski ?yeni=1 adresleri tam sayfa forma gider (customer/property ön seçimi taşınır).
  const newApptQuery = new URLSearchParams();
  if (sp.customer) newApptQuery.set("customer", sp.customer);
  if (sp.property) newApptQuery.set("property", sp.property);
  const newApptHref = newApptQuery.size ? `/app/randevular/yeni?${newApptQuery.toString()}` : "/app/randevular/yeni";
  if (sp.yeni === "1") redirect(newApptHref);
  const canCreateAppt = (gate.perms.appointments ?? []).includes("create");
  const tipF = sp.tip && typeLabel[sp.tip] ? sp.tip : "";
  const durumF = sp.durum && (FILTERABLE_STATUSES as readonly string[]).includes(sp.durum) ? sp.durum : "";
  const customerF = sp.customer ?? "";
  // ?property= — eşleştirme ekranındaki "Randevu ver" kısayolu portföyü de
  // taşır: liste o portföye süzülür ve yeni randevu diyaloğu ön seçili gelir.
  const propertyF = sp.property ?? "";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const density = densityOf(sp.yogunluk);
  const page = parsePage(sp.sayfa);

  // ?gorunum=ay|hafta|gun|rota — ay: mevcut takvim, hafta: 7 kolonlu saat ızgarası,
  // gün: tek kolon detay, rota: günün durak listesi + harita. ?tarih=YYYY-MM-DD
  // hafta/gün gezinmesi için; rota kendi ?gun=bugun|yarin paramını kullanır.
  const gorunum =
    sp.gorunum === "hafta" || sp.gorunum === "gun" || sp.gorunum === "rota" ? sp.gorunum : "ay";
  // Rota görünümü: ?gun=bugun|yarin (varsayılan bugün), ?danisman= yönetici filtresi
  const rotaGun: "bugun" | "yarin" = sp.gun === "yarin" ? "yarin" : "bugun";
  const isYonetici = MANAGEMENT_TIER_ROLES.includes(gate.role as TeamRole);
  // Danışman filtresi (Ekip Merkezi / Kıyas bağlantıları): yalnız yönetici rolleri; doğrulanmış uuid.
  const danismanF = isYonetici ? uuidParam(sp.danisman) : "";
  // Şube filtresi (appointments.branch_id): yalnız yönetim katmanı; doğrulanmış uuid.
  const subeF = isYonetici ? uuidParam(sp.sube) : "";
  const tarihMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sp.tarih ?? "");
  // todayStart: TR takvim günü (sunucu UTC'de olsa da gece 00–03 TRT arası doğru gün).
  // "Sahte yerel" Date — yalnız gün bileşenleri anlamlı; DB sınırı için toIso() kullan.
  const todayStart = trTodayCalendarDate();
  const toIso = calendarDateToTrIso;
  const selectedDate = tarihMatch
    ? new Date(Number(tarihMatch[1]), Number(tarihMatch[2]) - 1, Number(tarihMatch[3]))
    : todayStart;
  const fmtTarih = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shiftDate = (d: Date, days: number) => {
    const n = new Date(d);
    n.setDate(d.getDate() + days);
    return n;
  };

  // ---- Görünüme göre takvim penceresi ------------------------------------
  // Ana sorgu görünümün tarih penceresine (gte/lt) daraltılır — pencere içindeki TÜM
  // randevular gelir (hafta/gün gezinmesi ?tarih= ile sunucuya döner).
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  let windowStart: Date;
  let windowEnd: Date;
  if (gorunum === "hafta") {
    const ws = new Date(selectedDate);
    ws.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7));
    windowStart = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate());
    windowEnd = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7);
  } else if (gorunum === "gun") {
    windowStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + 1);
  } else if (gorunum === "rota") {
    windowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + (rotaGun === "yarin" ? 1 : 0));
    windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + 1);
  } else {
    // ay: aylık takvim istemci tarafında gezinir; sunucu makul bir pencere verir
    // (2 ay öncesi – 3 ay sonrası). Küçük ofisin yakın verisi tam kapsanır.
    windowStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 2, 1);
    windowEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 3, 1);
  }

  // Arama: müşteri adı / portföy başlığı-kodu / konum → ana sorgunun or() koşulu
  const search = await relatedSearchClause(supabase, q, {
    customerColumn: "customer_id",
    propertyColumn: "property_id",
    extraColumns: ["location"],
  });

  const APPT_LIMIT = 500;
  // Liste ve (tavana dayanınca) head-count aynı filtre kurucusunu paylaşır.
  const buildApptQuery = (select: string, opts?: { count: "exact"; head: true }) => {
    let query = supabase
      .from("appointments")
      .select(select, opts)
      .neq("status", "cancelled")
      .gte("scheduled_at", toIso(windowStart))
      .lt("scheduled_at", toIso(windowEnd));
    if (tipF) query = query.eq("appointment_type", tipF);
    if (durumF) query = query.eq("status", durumF);
    if (customerF) query = query.eq("customer_id", customerF);
    if (propertyF) query = query.eq("property_id", propertyF);
    if (danismanF) query = query.eq("assigned_to", danismanF);
    if (subeF) query = query.eq("branch_id", subeF);
    if (search.empty) query = query.eq("id", NIL_UUID);
    else if (search.clause) query = query.or(search.clause);
    return query;
  };
  const apptQuery = buildApptQuery(
    "id, appointment_type, scheduled_at, duration_min, location, status, notes, confirm_token, customer_response, assigned_to, outcome, outcome_note, signed_at, customer:customers!appointments_customer_id_fkey(id, full_name), property:properties!appointments_property_id_fkey(id, title, property_code, lat, lng)",
  );

  // Durum/tür sayaçları — pencereden bağımsız gerçek toplamlar (head-count; danışman kapsamlı);
  // iptaller hariç. KPI/çip sayıları bu sayıları filtreye çevirir.
  const countBase = () => {
    let c = supabase.from("appointments").select("id", { count: "exact", head: true }).neq("status", "cancelled");
    if (danismanF) c = c.eq("assigned_to", danismanF);
    if (subeF) c = c.eq("branch_id", subeF);
    return c;
  };
  const todayEndIso = toIso(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1));
  const weekAheadIso = toIso(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 7));

  // Rota verisi (yalnız ?gorunum=rota) ana sorgulardan bağımsız: aynı turda başlatılır.
  const rotaSelectedAdvisor = danismanF || gate.userId;
  const rotaDayStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + (rotaGun === "yarin" ? 1 : 0));
  const rotaDayEnd = new Date(rotaDayStart.getFullYear(), rotaDayStart.getMonth(), rotaDayStart.getDate() + 1);
  const rotaFetch =
    gorunum === "rota"
      ? (async () => {
          let rotaQuery = supabase
            .from("appointments")
            .select(
              "id, appointment_type, scheduled_at, duration_min, location, customer:customers!appointments_customer_id_fkey(id, full_name), property:properties!appointments_property_id_fkey(id, title, property_code, lat, lng)",
            )
            .neq("status", "cancelled")
            .eq("assigned_to", rotaSelectedAdvisor);
          // Üstteki tip/durum çipleri rota görünümünde de sorguya iner (filtre kontratı)
          if (tipF) rotaQuery = rotaQuery.eq("appointment_type", tipF);
          if (durumF) rotaQuery = rotaQuery.eq("status", durumF);
          return rotaQuery
            .gte("scheduled_at", toIso(rotaDayStart))
            .lt("scheduled_at", toIso(rotaDayEnd))
            .order("scheduled_at", { ascending: true })
            .limit(50);
        })()
      : null;

  // Randevu listesi bir kez başlatılır; izin sorgusu liste biter bitmez DİĞER sorgularla
  // paralel koşar.
  const apptP = Promise.resolve(apptQuery.order("scheduled_at", { ascending: true }).limit(APPT_LIMIT));
  // Gerçek toplam yalnız liste 500 tavanına dayanırsa sayılır (ListLimitNotice).
  const apptTotalP = apptP.then((res) =>
    resolveLazyTotal({
      rows: (res.data ?? []).length,
      limit: APPT_LIMIT,
      count: async () => (await buildApptQuery("id", { count: "exact", head: true })).count,
    }),
  );
  const leavesP = apptP.then(async (res) => {
    const list = (res.data ?? []) as unknown as AppointmentRow[];
    if (list.length === 0) return [] as LeaveLike[];
    const dayKeys = list.map((r) => new Date(Date.parse(r.scheduled_at) + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10));
    const { data: leaves } = await supabase
      .from("staff_leaves")
      .select("staff_id, starts_on, ends_on, status")
      .eq("status", "onayli")
      .lte("starts_on", dayKeys.reduce((a, d) => (d > a ? d : a), dayKeys[0]!))
      .gte("ends_on", dayKeys.reduce((a, d) => (d < a ? d : a), dayKeys[0]!))
      .limit(500);
    return (leaves ?? []) as LeaveLike[];
  });

  const [
    { data: appts },
    apptTotal,
    apptTypeDefs,
    { data: filteredCustomer },
    { data: filteredProperty },
    { count: todayCount },
    { count: pendingCount },
    { count: confirmedCount },
    { count: signatureCount },
    { count: completedCount },
    { count: showingCount },
    { count: officeCount },
    { count: valuationCount },
    { count: contractCount },
    { data: weekBarRows },
    { data: ownProfile },
    leaveRows,
    { data: advisorRows },
    savedViews,
  ] = await batchAll("Randevular", [
    "appointments", "appointments-total", "appointment-types", "filter-customer", "filter-property",
    "count-today", "count-pending", "count-confirmed", "count-signature", "count-completed",
    "count-showing", "count-office", "count-valuation", "count-contract",
    "week-bar", "own-profile", "leaves", "advisors", "saved-views",
  ], [
    apptP,
    apptTotalP,
    getDefinitions("appointment_type"),
    // ?customer= ile gelindiğinde (müşteri kartındaki "Randevu ver") çipte ad
    // gösterebilmek için tek kayıt.
    customerF
      ? supabase.from("customers").select("id, full_name").eq("id", customerF).maybeSingle()
      : Promise.resolve({ data: null }),
    // ?property= ile gelindiğinde (eşleştirme → "Randevu ver") çipte ad için tek kayıt.
    propertyF
      ? supabase.from("properties").select("id, title, property_code").eq("id", propertyF).maybeSingle()
      : Promise.resolve({ data: null }),
    countBase().gte("scheduled_at", toIso(todayStart)).lt("scheduled_at", todayEndIso),
    countBase().eq("status", "pending"),
    countBase().eq("status", "confirmed"),
    countBase().eq("status", "signature"),
    countBase().eq("status", "completed"),
    countBase().eq("appointment_type", "showing"),
    countBase().eq("appointment_type", "office"),
    countBase().eq("appointment_type", "valuation"),
    countBase().eq("appointment_type", "contract"),
    // Haftalık yoğunluk şeridi — önümüzdeki 7 gün, görünümden bağımsız pencere.
    (() => {
      let w = supabase
        .from("appointments")
        .select("scheduled_at")
        .neq("status", "cancelled")
        .gte("scheduled_at", toIso(todayStart))
        .lt("scheduled_at", weekAheadIso);
      if (danismanF) w = w.eq("assigned_to", danismanF);
      return w.limit(1000);
    })(),
    // Takvim aboneliği (ICS) için kullanıcının gizli token'ı — diğerlerinden bağımsız.
    supabase.from("user_calendar_tokens").select("token").eq("user_id", gate.userId).maybeSingle(),
    leavesP,
    // Danışman listesi (yönetici filtresi + rota seçicisi)
    isYonetici
      ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(200)
      : Promise.resolve({ data: null as { id: string; full_name: string | null }[] | null }),
    savedViewsPromise,
  ]);

  // Tür başına gerçek toplam (KPI + çipler).
  const typeCounts: Record<string, number> = {
    showing: showingCount ?? 0,
    office: officeCount ?? 0,
    valuation: valuationCount ?? 0,
    contract: contractCount ?? 0,
  };
  const statusCounts: Record<string, number> = {
    pending: pendingCount ?? 0,
    confirmed: confirmedCount ?? 0,
    signature: signatureCount ?? 0,
    completed: completedCount ?? 0,
  };
  const totalAppointments = sumCounts(typeCounts);

  // Takvim aboneliği (ICS) linki — ownProfile yukarıdaki toplu turda gelir.
  const calendarToken = (ownProfile?.token as string | null) ?? null;
  const appointmentTypeOptions = apptTypeDefs.length > 0 ? apptTypeDefs.map((t) => ({ value: t.value, label: t.label })) : undefined;

  const rows = (appts ?? []) as unknown as AppointmentRow[];

  const advisorList = (advisorRows ?? []).map((a) => ({ id: String(a.id), name: String(a.full_name ?? "İsimsiz danışman") }));
  const advisorName = new Map(advisorList.map((a) => [a.id, a.name]));
  // Şube seçenekleri (yönetim katmanı; tek şubeli ofiste seçici çizilmez).
  const branchList = isYonetici
    ? (((await supabase.from("branches").select("id, name").eq("is_active", true).order("name").limit(100)).data ?? []) as { id: string; name: string }[])
    : [];
  // Düzenleme panelindeki danışman seçici: yalnız yönetim katmanında (sunucu aynı kuralı uygular).
  const editAdvisors = isYonetici ? advisorList.map((a) => ({ id: a.id, label: a.name })) : undefined;

  // Filtre linkleri diğer parametreleri korur (görünüm/tarih/arama/danışman dahil).
  const apptHref = (patch: { tip?: string; durum?: string; customer?: string; property?: string; gorunum?: string; tarih?: string; gun?: string; danisman?: string; q?: string }) => {
    const tip = patch.tip !== undefined ? patch.tip : tipF;
    const durum = patch.durum !== undefined ? patch.durum : durumF;
    const cust = patch.customer !== undefined ? patch.customer : customerF;
    const prop = patch.property !== undefined ? patch.property : propertyF;
    const view = patch.gorunum !== undefined ? patch.gorunum : gorunum;
    const tarih = patch.tarih !== undefined ? patch.tarih : (sp.tarih ?? "");
    const gun = patch.gun !== undefined ? patch.gun : rotaGun;
    const danisman = patch.danisman !== undefined ? patch.danisman : danismanF;
    const qq = patch.q !== undefined ? patch.q : q;
    const usp = new URLSearchParams();
    if (qq) usp.set("q", qq);
    if (tip) usp.set("tip", tip);
    if (durum) usp.set("durum", durum);
    if (cust) usp.set("customer", cust);
    if (prop) usp.set("property", prop);
    if (view && view !== "ay") usp.set("gorunum", view);
    if (tarih && (view === "hafta" || view === "gun")) usp.set("tarih", tarih);
    if (view === "rota" && gun !== "bugun") usp.set("gun", gun);
    if (danisman) usp.set("danisman", danisman);
    if (density === "kompakt") usp.set("yogunluk", "kompakt");
    const s = usp.toString();
    return s ? `${PATH}?${s}` : PATH;
  };

  // Doğrulanmış URL durumu — toolbar, çipler, sayfalama ve kayıtlı görünümler TEK kaynaktan beslenir.
  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (tipF) urlParams.tip = tipF;
  if (durumF) urlParams.durum = durumF;
  if (customerF) urlParams.customer = customerF;
  if (propertyF) urlParams.property = propertyF;
  if (gorunum !== "ay") urlParams.gorunum = gorunum;
  if ((gorunum === "hafta" || gorunum === "gun") && sp.tarih) urlParams.tarih = sp.tarih;
  if (gorunum === "rota" && rotaGun !== "bugun") urlParams.gun = rotaGun;
  if (danismanF) urlParams.danisman = danismanF;
  if (subeF) urlParams.sube = subeF;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  const savedViewParams = Object.fromEntries(
    Object.entries(urlParams).filter(([k]) => ["q", "tip", "durum", "gorunum", "danisman"].includes(k)),
  );

  // Haftalık yoğunluk — ayrı "önümüzdeki 7 gün" penceresinden (görünümden bağımsız).
  const week = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + i);
    const dKey = fmtTarih(d);
    const count = ((weekBarRows ?? []) as { scheduled_at: string }[]).filter((r) => trDayKey(r.scheduled_at) === dKey).length;
    return { label: d.toLocaleDateString("tr-TR", { weekday: "short" }), day: d.getDate(), count, isToday: i === 0, key: dKey };
  });
  const weekTotal = week.reduce((n, w) => n + w.count, 0);
  const weekReliable = (weekBarRows ?? []).length < 1000;

  const sameLocalDay = (iso: string, d: Date) => trDayKey(iso) === fmtTarih(d);

  // Hafta/gün ızgarası için sadeleştirilmiş satırlar
  const weekViewRows: WeekViewAppointment[] = rows.map((r) => {
    const c = rel(r.customer);
    const p = rel(r.property);
    return {
      id: r.id,
      scheduled_at: r.scheduled_at,
      duration_min: r.duration_min,
      appointment_type: r.appointment_type,
      status: r.status,
      customerName: c?.full_name ?? null,
      propertyName: p?.title || p?.property_code || null,
      location: r.location,
    };
  });

  // Rota önerisi: seçili günde koordinatlı 2+ yer gösterme varsa görünür.
  const routeStops: RouteStop[] = rows
    .filter((r) => r.appointment_type === "showing" && sameLocalDay(r.scheduled_at, selectedDate))
    .flatMap((r) => {
      const p = rel(r.property);
      return p?.id && p.lat != null && p.lng != null
        ? [{
            appointmentId: r.id,
            propertyId: p.id,
            label: p.title || p.property_code || "Portföy",
            time: r.scheduled_at,
            lat: p.lat,
            lng: p.lng,
          }]
        : [];
    });

  // ---- Rota görünümü verisi — yalnız ?gorunum=rota iken sorgulanır ----
  // Varsayılan danışman: giriş yapan kullanıcı; yönetici ?danisman= ile ekipten
  // birini seçebilir. Gün: ?gun=bugun|yarin. Koordinat kaynağı: properties.lat/lng
  // (portföy koordinatı) — appointments.gps_lat/gps_lng imza GPS'idir, plana girmez.
  let rotaDuraklar: RotaDurak[] = [];
  let rotaTotalKm = 0;
  let rotaTightCount = 0;
  let rotaAdvisors: RotaAdvisor[] | null = null;
  if (gorunum === "rota") {
    type RotaRow = {
      id: string;
      appointment_type: string;
      scheduled_at: string;
      duration_min: number | null;
      location: string | null;
      customer: Rel;
      property: Rel;
    };
    const { data: rotaRows } = await rotaFetch!;
    const rotaList = (rotaRows ?? []) as unknown as RotaRow[];
    const byId = new Map(rotaList.map((r) => [r.id, r]));
    const planStops: RoutePlanStop[] = rotaList.map((r) => {
      const p = rel(r.property);
      return {
        id: r.id,
        scheduledAt: r.scheduled_at,
        durationMin: r.duration_min,
        lat: p?.lat ?? null,
        lng: p?.lng ?? null,
      };
    });
    const plan = buildRoutePlan(planStops);
    rotaTotalKm = plan.totalKm;
    rotaTightCount = plan.tightCount;

    rotaDuraklar = plan.stops.flatMap((s, i) => {
      const r = byId.get(s.id);
      if (!r) return [];
      const c = rel(r.customer);
      const p = rel(r.property);
      const directionsHref = directionsHrefFor({ lat: s.lat, lng: s.lng, location: r.location });
      return [{
        id: r.id,
        order: i + 1,
        timeLabel: formatTrTime(r.scheduled_at),
        typeLabel: typeLabel[r.appointment_type] ?? r.appointment_type,
        typeToneCls: typeTone[r.appointment_type] ?? typeTone.showing,
        customerId: c?.id ?? null,
        customerName: c?.full_name ?? "Belirtilmemiş",
        propertyId: p?.id ?? null,
        propertyName: p?.title || p?.property_code || null,
        location: r.location,
        durationMin: r.duration_min,
        lat: s.lat,
        lng: s.lng,
        directionsHref,
        leg: plan.legs[i],
      }];
    });
    if (isYonetici) {
      rotaAdvisors = advisorList.map((a) => ({ id: a.id, name: a.name }));
      if (!rotaAdvisors.some((a) => a.id === gate.userId)) {
        rotaAdvisors.unshift({ id: gate.userId, name: "Ben" });
      }
      if (!rotaAdvisors.some((a) => a.id === rotaSelectedAdvisor)) {
        rotaAdvisors.unshift({ id: rotaSelectedAdvisor, name: "Seçili danışman" });
      }
    }
  }
  // Danışman seçicinin koruyacağı diğer paramlar (danisman hariç)
  const rotaBaseQuery = (() => {
    const usp = new URLSearchParams();
    if (tipF) usp.set("tip", tipF);
    if (durumF) usp.set("durum", durumF);
    if (customerF) usp.set("customer", customerF);
    usp.set("gorunum", "rota");
    if (rotaGun !== "bugun") usp.set("gun", rotaGun);
    return usp.toString();
  })();

  const viewOptions: ViewOption[] = [
    { value: "ay", label: "Ay", icon: CalendarDays, href: apptHref({ gorunum: "ay" }) },
    { value: "hafta", label: "Hafta", icon: CalendarRange, href: apptHref({ gorunum: "hafta" }) },
    { value: "gun", label: "Gün", icon: Clock3, href: apptHref({ gorunum: "gun" }) },
    { value: "rota", label: "Rota", icon: RouteIcon, href: apptHref({ gorunum: "rota" }) },
  ];

  // ---- Satır modelleri (tablo + mobil liste ortak veri) ---------------------
  const nowMs = now();
  const win = pageWindow(page, rows.length, PAGE_SIZE, rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).length);
  const pageRows = rows.slice(win.offset, win.offset + PAGE_SIZE);
  const viewModels: AppointmentVM[] = pageRows.map((appt) => {
    const customer = rel(appt.customer);
    const property = rel(appt.property);
    const date = new Date(appt.scheduled_at);
    const customerName = customer?.full_name ?? "Belirtilmemiş";
    const propertyName = property?.title || property?.property_code || "Portföy bağlanmadı";
    const cardHref = customer?.id
      ? `/app/musteriler/${customer.id}`
      : property?.id
        ? `/app/portfoyler/${property.id}`
        : null;
    // Yer gösterme randevusundan tutanak kısayolu: sözleşme diyaloğu
    // customer/property/tur parametrelerini ön dolgu olarak okur.
    const tutanakParams = new URLSearchParams();
    if (customer?.id) tutanakParams.set("customer", customer.id);
    if (property?.id) tutanakParams.set("property", property.id);
    tutanakParams.set("tur", "yer_gosterme");
    const outcome = appt.outcome && isAppointmentOutcome(appt.outcome) ? APPOINTMENT_OUTCOME_META[appt.outcome] : null;
    return {
      id: appt.id,
      status: appt.status,
      dateLabel: new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" }).format(date),
      timeLabel: formatTrTime(date),
      customerId: customer?.id ?? null,
      customerName,
      cardHref,
      typeLabel: typeLabel[appt.appointment_type] ?? appt.appointment_type,
      typeTone: appointmentTypeTone(appt.appointment_type),
      propertyId: property?.id ?? null,
      propertyName,
      location: appt.location,
      durationMin: appt.duration_min,
      onLeave: Boolean(
        appt.assigned_to &&
          isOnLeave(leaveRows, appt.assigned_to, new Date(date.getTime() + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10)),
      ),
      statusLabel: APPOINTMENT_STATUS_LABELS[appt.status] ?? APPOINTMENT_STATUS_LABELS.pending!,
      statusTone: appointmentStatusTone(appt.status),
      response: appt.customer_response && CUSTOMER_RESPONSE_META[appt.customer_response] ? CUSTOMER_RESPONSE_META[appt.customer_response]! : null,
      outcome:
        outcome && appt.outcome
          ? { label: outcome.label, emoji: outcome.emoji, tone: OUTCOME_TONE[appt.outcome] ?? "neutral", note: appt.outcome_note }
          : null,
      followUp: needsFollowUp(appt.status, date.getTime(), nowMs),
      signedLabel: appt.signed_at
        ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }).format(new Date(appt.signed_at))
        : null,
      confirmToken: appt.confirm_token,
      isShowing: appt.appointment_type === "showing",
      tutanakHref: `/app/sozlesmeler?${tutanakParams.toString()}`,
      edit: {
        id: appt.id,
        appointment_type: appt.appointment_type,
        scheduled_at: appt.scheduled_at,
        duration_min: appt.duration_min,
        location: appt.location,
        notes: appt.notes,
        assigned_to: appt.assigned_to,
        customer_id: customer?.id ?? null,
        customer_label: customer?.full_name ?? null,
        property_id: property?.id ?? null,
        property_label: property?.title || property?.property_code || null,
      },
      calendarEvent: {
        uid: appt.id,
        title: `${typeLabel[appt.appointment_type] ?? appt.appointment_type} — ${customerName}`,
        description: `${propertyName}${appt.notes ? `\n${appt.notes}` : ""}`,
        location: appt.location ?? undefined,
        startAt: date,
        endAt: appt.duration_min ? new Date(date.getTime() + appt.duration_min * 60_000) : undefined,
      },
    };
  });

  // ---- KPI şeridi: yalnız gerçekten hesaplanan sayılar -----------------------
  const todayKey = fmtTarih(todayStart);
  const kpis: KpiItem[] = [
    { label: "Bugünkü randevu", value: todayCount ?? 0, icon: <ICONS.randevu />, tone: "info", href: apptHref({ gorunum: "gun", tarih: todayKey }), hint: "bugün planlı" },
  ];
  if (weekReliable) {
    kpis.push({ label: "Önümüzdeki 7 gün", value: weekTotal, icon: <CalendarClock />, tone: "info", href: apptHref({ gorunum: "hafta", tarih: todayKey }), hint: "planlı randevu" });
  }
  kpis.push(
    { label: "Teyit bekliyor", value: statusCounts.pending!, icon: <Hourglass />, tone: "warning", href: apptHref({ durum: "pending", gorunum: "ay" }), hint: "müşteri yanıtı yok" },
    { label: "İmza eksik", value: statusCounts.signature!, icon: <FileSignature />, tone: "danger", href: apptHref({ durum: "signature", gorunum: "ay" }), attention: true, hint: "imza bekleyen" },
    { label: "Yer gösterme", value: typeCounts.showing!, icon: <MapPinned />, tone: "success", href: apptHref({ tip: "showing", gorunum: "ay" }), hint: "toplam" },
    { label: "Tamamlanan", value: statusCounts.completed!, icon: <CheckCircle2 />, tone: "success", href: apptHref({ durum: "completed", gorunum: "ay" }), hint: "sonuçlanan" },
  );

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "tip", label: "Tür", format: (v) => typeLabel[v] ?? v },
    { key: "durum", label: "Durum", format: (v) => APPOINTMENT_STATUS_LABELS[v] ?? v },
    { key: "customer", label: "Müşteri", format: () => filteredCustomer?.full_name ?? "Seçili müşteri" },
    { key: "property", label: "Portföy", format: () => filteredProperty?.title || filteredProperty?.property_code || "Seçili portföy" },
    { key: "danisman", label: "Danışman", format: (v) => advisorName.get(v) ?? "Seçili danışman" },
    { key: "sube", label: "Şube", format: (v) => branchList.find((b) => b.id === v)?.name ?? "Seçili şube" },
  ]);

  return (
    <ListPage>
      <ListHero
        eyebrow="Saha planı"
        art="randevu"
        title="Randevular & yer gösterme"
        description="Yer gösterme, görüşme ve tur planını tek akışta yönetin."
        actions={
          <>
            {/* Mevcut filtre kapsamındaki randevular tek .ics olarak (maks. 500) */}
            <ExportIcsButton
              events={rows.map((r) => {
                const c = rel(r.customer);
                const p = rel(r.property);
                const propertyName = p?.title || p?.property_code || "Portföy bağlanmadı";
                return {
                  uid: r.id,
                  title: `${typeLabel[r.appointment_type] ?? r.appointment_type} — ${c?.full_name ?? "Belirtilmemiş"}`,
                  description: `${propertyName}${r.notes ? `\n${r.notes}` : ""}`,
                  location: r.location ?? undefined,
                  startAt: r.scheduled_at,
                  durationMin: r.duration_min,
                };
              })}
            />
            {canCreateAppt ? <ButtonLink href={newApptHref} icon={Plus}>Yeni randevu</ButtonLink> : null}
          </>
        }
      />

      <KpiStrip items={kpis} />

      {/* Haftalık yük (önümüzdeki 7 gün, gerçek sayım; her gün gün görünümüne iner) + randevu türü dağılımı */}
      <ListCharts>
        {weekReliable ? (
          <ColumnChartCard
            title="Haftalık yük"
            subtitle="Önümüzdeki 7 gün · planlı randevu"
            icon={CalendarClock}
            href={apptHref({ gorunum: "hafta", tarih: todayKey })}
            highlight={0}
            bars={week.map((w) => ({
              label: w.isToday ? "Bugün" : `${w.label} ${w.day}`,
              value: w.count,
              title: `${w.label} ${w.day}: ${w.count} randevu`,
              href: apptHref({ gorunum: "gun", tarih: w.key }),
            }))}
          />
        ) : null}
        <DistributionCard
          title="Randevu türü"
          subtitle="Tüm randevuların türe göre dağılımı"
          icon={PieChart}
          tone="success"
          href={apptHref({ tip: "", gorunum: "ay" })}
          centerLabel="randevu"
          slices={Object.entries(typeCounts).map(([value, count]) => ({
            label: typeLabel[value] ?? value,
            value: count,
            href: apptHref({ tip: value, gorunum: "ay" }),
          }))}
        />
      </ListCharts>

      <ListToolbar
        pathname={PATH}
        params={urlParams}
        views={viewOptions}
        activeView={gorunum}
        searchPlaceholder="Müşteri, portföy veya konum ara…"
        searchLabel="Randevu ara"
        panelParamKeys={["danisman", "sube"]}
        panel={
          isYonetici && (advisorList.length > 0 || branchList.length > 1) ? (
            <FilterGrid>
              {advisorList.length > 0 ? (
                <FilterSelect
                  name="danisman"
                  label="Danışman"
                  value={danismanF}
                  options={[{ value: "", label: "Tüm danışmanlar" }, ...advisorList.map((a) => ({ value: a.id, label: a.name }))]}
                />
              ) : null}
              {branchList.length > 1 || subeF ? (
                <FilterSelect
                  name="sube"
                  label="Şube"
                  value={subeF}
                  options={[{ value: "", label: "Tüm şubeler" }, ...branchList.map((b) => ({ value: b.id, label: b.name }))]}
                />
              ) : null}
            </FilterGrid>
          ) : undefined
        }
        densityParam="yogunluk"
        chips={chips}
        resultCount={chips.length > 0 ? rows.length : undefined}
        resultNoun="randevu"
        savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
      />

      <div className="space-y-2">
        <CategoryChips
          options={Object.entries(typeLabel).map(([value, label]) => ({ value, label }))}
          counts={typeCounts}
          total={totalAppointments}
          active={tipF}
          pathname={PATH}
          params={urlParams}
          paramName="tip"
          label="Randevu türü"
        />
        <CategoryChips
          options={FILTERABLE_STATUSES.map((value) => ({ value, label: APPOINTMENT_STATUS_LABELS[value]! }))}
          counts={statusCounts}
          total={totalAppointments}
          allLabel="Tüm durumlar"
          active={durumF}
          pathname={PATH}
          params={urlParams}
          paramName="durum"
          label="Randevu durumu"
        />
      </div>

      {/* Takvim görünümü — ?gorunum=ay|hafta|gun|rota; hafta/gün ?tarih= ile gezinir. */}
      <div id="takvim" className="scroll-mt-24 space-y-4">
        {gorunum === "ay" ? (
          <AppointmentCalendar
            todayKey={todayKey}
            newHref={canCreateAppt ? newApptHref : null}
            appointments={rows.map((r) => ({
              id: r.id,
              scheduled_at: r.scheduled_at,
              appointment_type: r.appointment_type,
              status: r.status,
            }))}
          />
        ) : gorunum === "rota" ? (
          <RotaView
            gun={rotaGun}
            gunLabel={rotaDayStart.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
            bugunHref={apptHref({ gun: "bugun" })}
            yarinHref={apptHref({ gun: "yarin" })}
            stops={rotaDuraklar}
            totalKm={rotaTotalKm}
            tightCount={rotaTightCount}
            advisors={rotaAdvisors}
            selectedAdvisorId={rotaSelectedAdvisor}
            advisorBaseQuery={rotaBaseQuery}
            newAppointmentSlot={canCreateAppt ? <ButtonLink href={newApptHref} icon={Plus}>Yeni randevu</ButtonLink> : null}
          />
        ) : (
          <AppointmentWeekView
            mode={gorunum}
            date={selectedDate}
            appointments={weekViewRows}
            prevHref={apptHref({ tarih: fmtTarih(shiftDate(selectedDate, gorunum === "hafta" ? -7 : -1)) })}
            nextHref={apptHref({ tarih: fmtTarih(shiftDate(selectedDate, gorunum === "hafta" ? 7 : 1)) })}
            todayHref={apptHref({ tarih: fmtTarih(todayStart) })}
            newHref={canCreateAppt ? newApptHref : null}
          />
        )}

        {/* Seçili günde koordinatlı 2+ yer gösterme → en yakın komşu rotası.
            Rota görünümünde gizli — orada saat sıralı asıl rota planı var. */}
        {gorunum !== "rota" ? (
          <RouteSuggestion
            dateLabel={selectedDate.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
            stops={routeStops}
          />
        ) : null}
      </div>

      {/* Randevu listesi — görünüm penceresindeki randevular (tablo + mobil kart) */}
      {rows.length === 0 ? (
        totalAppointments === 0 && !danismanF ? (
          <EmptyState
            icon={ICONS.randevu}
            illustration="randevu"
            title="Henüz randevu yok"
            description="İlk yer gösterme veya görüşmenizi planladığınızda tur planı burada oluşacak."
            tone="mint"
            action={canCreateAppt ? { href: newApptHref, label: "Yeni randevu" } : undefined}
            secondary={{ href: "/app/musteriler", label: "Müşteri seç" }}
          />
        ) : (
          <EmptyState
            icon={Search}
            illustration="search"
            title="Bu pencerede randevu bulunamadı"
            description="Arama ifadenizi, filtreleri ya da takvim aralığını değiştirip tekrar deneyin."
            action={{ href: PATH, label: "Filtreleri temizle" }}
          />
        )
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
              <CalendarClock aria-hidden="true" className="h-4 w-4 text-brand-600" /> Randevu listesi
              <span className="numeric rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700">{rows.length}</span>
            </h2>
            {rows.some((r) => r.status === "pending" || r.status === "signature") ? (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <AlertTriangle aria-hidden="true" className="h-3 w-3" /> Teyit / imza bekleyenler durum sütununda işaretli
              </span>
            ) : null}
          </div>
          <ListLimitNotice shown={rows.length} total={apptTotal} hint="Geçmiş randevular için takvimi kullanın." />
          <AppointmentTable rows={viewModels} density={density} typeOptions={appointmentTypeOptions} advisors={editAdvisors} />
          <ListPager pathname={PATH} params={urlParams} window={win} total={rows.length} />
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Kişisel ICS abonelik linki — Google/Apple/Outlook otomatik senkron */}
        <CalendarSubscribeCard token={calendarToken} />

        {/* Müşterinin kendi randevusunu aldığı public link (/randevu-al/[token]) */}
        <BookingLinkCard userId={gate.userId} />
      </div>
    </ListPage>
  );
}
