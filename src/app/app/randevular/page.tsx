import {
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Clock3,
  FileSignature,
  MapPin,
  MapPinned,
  Navigation,
  Radio,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { setAppointmentStatus } from "@/app/actions/appointments";
import { NewAppointmentDialog } from "./new-appointment-dialog";
import { getDefinitions } from "@/lib/definitions";
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { AppointmentCalendar } from "./appointment-calendar";
import { AppointmentWeekView, type WeekViewAppointment } from "./appointment-week-view";
import { RouteSuggestion, type RouteStop } from "./route-suggestion";
import { RotaView, type RotaAdvisor, type RotaDurak } from "./rota-view";
import { buildRoutePlan, type RoutePlanStop } from "@/lib/route-plan";
import { AppointmentEditDialog } from "./appointment-edit-dialog";
import { ExportIcsButton } from "./export-ics-button";
import { CopyConfirmLink } from "./copy-confirm-link";
import { CalendarSubscribeCard } from "./calendar-subscribe-card";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";

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
  customer: Rel;
  property: Rel;
};

/** Müşterinin teyit linkinden verdiği yanıt — durum rozetinin yanında görünür. */
const responseMeta: Record<string, { label: string; cls: string }> = {
  coming: { label: "Geliyorum ✓", cls: "bg-mint-500/10 text-mint-600" },
  cancelled: { label: "İptal etti", cls: "bg-danger-500/10 text-danger-500" },
};

const typeLabel: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

const typeTone: Record<string, string> = {
  showing: "bg-brand-600/10 text-brand-600",
  office: "bg-cyan-400/12 text-cyan-500",
  valuation: "bg-amber-400/15 text-amber-500",
  contract: "bg-mint-500/12 text-mint-600",
};

const statusMeta: Record<string, { label: string; cls: string }> = {
  pending: { label: "Teyit bekliyor", cls: "bg-warn-500/10 text-warn-500" },
  confirmed: { label: "Onaylandı", cls: "bg-mint-500/10 text-mint-600" },
  signature: { label: "İmza eksik", cls: "bg-danger-500/10 text-danger-500" },
  completed: { label: "Tamamlandı", cls: "bg-mint-500/10 text-mint-600" },
  cancelled: { label: "İptal", cls: "bg-ink-950/8 text-text-muted" },
};

function rel(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

const FILTERABLE_STATUSES = ["pending", "confirmed", "signature", "completed"];

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tip?: string; durum?: string; customer?: string; gorunum?: string; tarih?: string; gun?: string; danisman?: string }>;
}) {
  const gate = await requireModulePage("appointments");
  const supabase = await createClient();
  const sp = (await searchParams) ?? {};
  const tipF = sp.tip && typeLabel[sp.tip] ? sp.tip : "";
  const durumF = sp.durum && FILTERABLE_STATUSES.includes(sp.durum) ? sp.durum : "";
  const customerF = sp.customer ?? "";

  // ?gorunum=ay|hafta|gun|rota — ay: mevcut takvim, hafta: 7 kolonlu saat ızgarası,
  // gün: tek kolon detay, rota: günün durak listesi + harita. ?tarih=YYYY-MM-DD
  // hafta/gün gezinmesi için; rota kendi ?gun=bugun|yarin paramını kullanır.
  const gorunum =
    sp.gorunum === "hafta" || sp.gorunum === "gun" || sp.gorunum === "rota" ? sp.gorunum : "ay";
  // Rota görünümü: ?gun=bugun|yarin (varsayılan bugün), ?danisman= yönetici filtresi
  const rotaGun: "bugun" | "yarin" = sp.gun === "yarin" ? "yarin" : "bugun";
  const YONETICI_ROLES = ["owner", "gm", "branch_manager", "team_lead"];
  const isYonetici = YONETICI_ROLES.includes(gate.role);
  const danismanF = isYonetici ? ((sp.danisman ?? "").trim() || "") : "";
  const tarihMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sp.tarih ?? "");
  const todayStart = (() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  })();
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

  let apptQuery = supabase
    .from("appointments")
    // count: liste 100 randevuyla sınırlı; yoğun bir ofiste bu kolayca
    // aşılır ve kullanıcı eksik takvim görüp bunu tam sanar.
    .select(
      "id, appointment_type, scheduled_at, duration_min, location, status, notes, confirm_token, customer_response, customer:customers(id, full_name), property:properties(id, title, property_code, lat, lng)",
      { count: "exact" },
    )
    .neq("status", "cancelled");
  if (tipF) apptQuery = apptQuery.eq("appointment_type", tipF);
  if (durumF) apptQuery = apptQuery.eq("status", durumF);
  if (customerF) apptQuery = apptQuery.eq("customer_id", customerF);

  const [{ data: appts, count: apptTotal }, { data: customers }, { data: properties }, apptTypeDefs, { data: filteredCustomer }] = await Promise.all([
    apptQuery.order("scheduled_at", { ascending: true }).limit(100),
    // Bu iki sorgu SINIRSIZDI: sayfa her acildiginda ofisin TUM musteri ve
    // portfoy kayitlari cekiliyordu. Secici artik sunucu tarafinda arama
    // yaptigi icin buradaki liste yalnizca "son eklenenler" kisayolu —
    // 50 kayit yeterli, gerisi yazarak bulunuyor.
    supabase.from("customers").select("id, full_name").is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("properties").select("id, title, property_code").is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    getDefinitions("appointment_type"),
    // ?customer= ile gelindiğinde (müşteri kartındaki "Randevu ver") çipte ad
    // gösterebilmek ve diyalogda müşteriyi önceden seçmek için tek kayıt.
    customerF
      ? supabase.from("customers").select("id, full_name").eq("id", customerF).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Takvim aboneliği (ICS) linki — kullanıcının kendi profilindeki gizli token.
  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("calendar_token")
    .eq("id", gate.userId)
    .maybeSingle();
  const calendarToken = (ownProfile?.calendar_token as string | null) ?? null;
  const appointmentTypeOptions = apptTypeDefs.length > 0 ? apptTypeDefs.map((t) => ({ value: t.value, label: t.label })) : undefined;

  const rows = (appts ?? []) as AppointmentRow[];
  const customerOptions = (customers ?? []).map((c) => ({ id: c.id, label: c.full_name }));
  if (filteredCustomer && !customerOptions.some((c) => c.id === filteredCustomer.id)) {
    customerOptions.unshift({ id: filteredCustomer.id, label: filteredCustomer.full_name });
  }
  const propertyOptions = (properties ?? []).map((p) => ({ id: p.id, label: p.title || p.property_code }));

  // Filtre linkleri diğer parametreleri korur (görünüm/tarih dahil).
  const apptHref = (patch: { tip?: string; durum?: string; customer?: string; gorunum?: string; tarih?: string; gun?: string; danisman?: string }) => {
    const tip = patch.tip !== undefined ? patch.tip : tipF;
    const durum = patch.durum !== undefined ? patch.durum : durumF;
    const cust = patch.customer !== undefined ? patch.customer : customerF;
    const view = patch.gorunum !== undefined ? patch.gorunum : gorunum;
    const tarih = patch.tarih !== undefined ? patch.tarih : (sp.tarih ?? "");
    const gun = patch.gun !== undefined ? patch.gun : rotaGun;
    const danisman = patch.danisman !== undefined ? patch.danisman : danismanF;
    const q = new URLSearchParams();
    if (tip) q.set("tip", tip);
    if (durum) q.set("durum", durum);
    if (cust) q.set("customer", cust);
    if (view && view !== "ay") q.set("gorunum", view);
    if (tarih && (view === "hafta" || view === "gun")) q.set("tarih", tarih);
    if (view === "rota") {
      if (gun !== "bugun") q.set("gun", gun);
      if (danisman) q.set("danisman", danisman);
    }
    const s = q.toString();
    return s ? `/app/randevular?${s}` : "/app/randevular";
  };

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const todayRows = rows.filter((r) => {
    const d = new Date(r.scheduled_at);
    return d >= startOfDay && d < endOfDay;
  });
  const showings = rows.filter((r) => r.appointment_type === "showing").length;
  const pendingSign = rows.filter((r) => r.status === "signature").length;

  const week = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(startOfDay);
    d.setDate(startOfDay.getDate() + i);
    const next = new Date(d.getTime() + 86_400_000);
    const count = rows.filter((r) => {
      const t = new Date(r.scheduled_at);
      return t >= d && t < next;
    }).length;
    return { label: d.toLocaleDateString("tr-TR", { weekday: "short" }), day: d.getDate(), count, isToday: i === 0 };
  });
  const maxWeek = Math.max(1, ...week.map((w) => w.count));

  const sameLocalDay = (iso: string, d: Date) => {
    const t = new Date(iso);
    return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
  };

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
  const rotaSelectedAdvisor = danismanF || gate.userId;
  const rotaDayStart = new Date(startOfDay.getTime() + (rotaGun === "yarin" ? 86_400_000 : 0));
  const rotaDayEnd = new Date(rotaDayStart.getTime() + 86_400_000);
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
    let rotaQuery = supabase
      .from("appointments")
      .select(
        "id, appointment_type, scheduled_at, duration_min, location, customer:customers(id, full_name), property:properties(id, title, property_code, lat, lng)",
      )
      .neq("status", "cancelled")
      .eq("assigned_to", rotaSelectedAdvisor);
    // Üstteki tip/durum çipleri rota görünümünde de sorguya iner (filtre kontratı)
    if (tipF) rotaQuery = rotaQuery.eq("appointment_type", tipF);
    if (durumF) rotaQuery = rotaQuery.eq("status", durumF);
    const [{ data: rotaRows }, advisorsRes] = await Promise.all([
      rotaQuery
        .gte("scheduled_at", rotaDayStart.toISOString())
        .lt("scheduled_at", rotaDayEnd.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(50),
      isYonetici
        ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(200)
        : Promise.resolve({ data: null as { id: string; full_name: string | null }[] | null }),
    ]);
    const rotaList = (rotaRows ?? []) as RotaRow[];
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
    const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
    rotaDuraklar = plan.stops.flatMap((s, i) => {
      const r = byId.get(s.id);
      if (!r) return [];
      const c = rel(r.customer);
      const p = rel(r.property);
      const directionsHref =
        s.lat != null && s.lng != null
          ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
          : r.location
            ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.location)}`
            : null;
      return [{
        id: r.id,
        order: i + 1,
        timeLabel: timeFmt.format(new Date(r.scheduled_at)),
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
      rotaAdvisors = (advisorsRes.data ?? []).map((a) => ({ id: a.id, name: a.full_name ?? "İsimsiz danışman" }));
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
    const q = new URLSearchParams();
    if (tipF) q.set("tip", tipF);
    if (durumF) q.set("durum", durumF);
    if (customerF) q.set("customer", customerF);
    q.set("gorunum", "rota");
    if (rotaGun !== "bugun") q.set("gun", rotaGun);
    return q.toString();
  })();

  const VIEW_TABS = [
    { key: "ay", label: "Ay" },
    { key: "hafta", label: "Hafta" },
    { key: "gun", label: "Gün" },
    { key: "rota", label: "Rota" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Saha planı canlı</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Randevular & yer gösterme</h1>
            <p className="mt-1 text-sm text-white/60">Yer gösterme, görüşme ve tur planını tek akışta yönetin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Mevcut filtre kapsamındaki randevular tek .ics olarak (maks. 200) */}
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
            <NewAppointmentDialog customers={customerOptions} properties={propertyOptions} typeOptions={appointmentTypeOptions} defaultCustomerId={filteredCustomer?.id} />
          </div>
        </div>
        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-3 gap-3">
            {/* Bugünkü sayaç takvime (bugün seçili açılır), diğerleri tip/durum filtresine iner. */}
            {[
              { label: "Bugünkü randevu", value: todayRows.length, icon: CalendarDays, tone: "text-cyan-400", href: "#takvim" },
              { label: "Yer gösterme", value: showings, icon: MapPinned, tone: "text-mint-400", href: apptHref({ tip: tipF === "showing" ? "" : "showing" }) },
              { label: "İmza eksik", value: pendingSign, icon: FileSignature, tone: "text-danger-500", href: apptHref({ durum: durumF === "signature" ? "" : "signature" }) },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <item.icon className={`h-4 w-4 ${item.tone}`} />
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
                <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
              </Link>
            ))}
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><CalendarClock className="h-3.5 w-3.5 text-cyan-400" /> Haftalık yoğunluk</p>
              <span className="text-[11px] text-white/45">önümüzdeki 7 gün</span>
            </div>
            <div className="mt-4 flex h-24 items-end gap-2">
              {week.map((w, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-bold tabular-nums text-white/55">{w.count || ""}</span>
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className={`bar-live w-full max-w-[18px] rounded-t-[4px] ${w.isToday ? "bg-[image:var(--grad-brand)] shadow-[0_0_12px_-1px_rgba(20,99,255,0.7)]" : "bg-white/25"}`}
                      style={{ height: `${Math.max((w.count / maxWeek) * 100, 6)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                  <span className={`text-[10px] ${w.isToday ? "font-bold text-cyan-300" : "text-white/40"}`}>{w.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tip / durum filtre çipleri — sunucu tarafında sorguya iner */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={apptHref({ tip: "", durum: "" })}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            !tipF && !durumF
              ? "bg-brand-600 text-white"
              : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"
          }`}
        >
          Tümü
        </Link>
        {Object.entries(typeLabel).map(([key, label]) => {
          const active = tipF === key;
          return (
            <Link
              key={key}
              href={apptHref({ tip: active ? "" : key })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-brand-600 text-white"
                  : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"
              }`}
            >
              {label}
            </Link>
          );
        })}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        {FILTERABLE_STATUSES.map((key) => {
          const active = durumF === key;
          return (
            <Link
              key={key}
              href={apptHref({ durum: active ? "" : key })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-mint-600 text-white"
                  : "border border-line bg-surface text-text-muted hover:border-mint-500/50 hover:text-mint-600"
              }`}
            >
              {statusMeta[key].label}
            </Link>
          );
        })}
        {filteredCustomer ? (
          <Link
            href={apptHref({ customer: "" })}
            className="rounded-full bg-cyan-500/15 px-3.5 py-1.5 text-xs font-semibold text-cyan-600 transition hover:bg-cyan-500/25"
            title="Müşteri filtresini kaldır"
          >
            Müşteri: {filteredCustomer.full_name} ✕
          </Link>
        ) : null}
      </div>

      {/* Takvim görünümü — #takvim: hero "Bugünkü randevu" sayacının hedefi.
          ?gorunum=ay|hafta|gun geçişi; hafta/gün ?tarih= ile gezinir. */}
      <div id="takvim" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {VIEW_TABS.map((v) => {
            const active = gorunum === v.key;
            return (
              <Link
                key={v.key}
                href={apptHref({ gorunum: v.key })}
                className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                    : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                {v.label}
              </Link>
            );
          })}
        </div>

        {gorunum === "ay" ? (
          <AppointmentCalendar
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
            newAppointmentSlot={
              <NewAppointmentDialog
                customers={customerOptions}
                properties={propertyOptions}
                typeOptions={appointmentTypeOptions}
                defaultCustomerId={filteredCustomer?.id}
              />
            }
          />
        ) : (
          <AppointmentWeekView
            mode={gorunum}
            date={selectedDate}
            appointments={weekViewRows}
            prevHref={apptHref({ tarih: fmtTarih(shiftDate(selectedDate, gorunum === "hafta" ? -7 : -1)) })}
            nextHref={apptHref({ tarih: fmtTarih(shiftDate(selectedDate, gorunum === "hafta" ? 7 : 1)) })}
            todayHref={apptHref({ tarih: fmtTarih(todayStart) })}
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

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {/* timeline */}
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Henüz randevu yok"
            description="İlk yer gösterme veya görüşmenizi planladığınızda tur planı burada oluşacak."
            tone="mint"
          />
        ) : (
          <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><CalendarClock className="h-4 w-4" /> Tur planı</p>
                <h2 className="mt-1 font-display font-bold text-ink-950">Yaklaşan randevular</h2>
              </div>
              <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">{rows.length} kayıt</span>
            </div>
            <div className="px-5 pt-3">
              <ListLimitNotice shown={rows.length} total={apptTotal} hint="Geçmiş randevular için takvimi kullanın." />
            </div>
            <div className="divide-y divide-line">
              {rows.map((appt) => {
                const status = statusMeta[appt.status] ?? statusMeta.pending;
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
                const tutanakHref = `/app/sozlesmeler?${tutanakParams.toString()}`;
                return (
                  // id: takvimdeki gün öğeleri #randevu-{id} çapasıyla buraya kaydırır
                  <article key={appt.id} id={`randevu-${appt.id}`} className="group relative grid scroll-mt-24 gap-3 px-5 py-4 transition target:bg-brand-600/[0.06] hover:bg-brand-600/[0.02] md:grid-cols-[64px_1fr_auto] md:items-center">
                    {cardHref ? (
                      <Link href={cardHref} className="absolute inset-0" aria-label={`${customerName} randevusu detayı`} />
                    ) : null}
                    <div className="flex flex-col items-center justify-center rounded-[12px] border border-line bg-canvas py-2">
                      <span className="font-display text-base font-extrabold tabular-nums text-ink-950">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date)}</span>
                      <span className="text-[10px] uppercase tracking-[0.08em] text-text-faint">{new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(date)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-800 text-[11px] font-bold text-white">{initials(customerName)}</span>
                        <p className="text-sm font-semibold text-ink-950">{customerName}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${typeTone[appt.appointment_type] ?? typeTone.showing}`}>{typeLabel[appt.appointment_type] ?? appt.appointment_type}</span>
                      </div>
                      {property?.id ? (
                        <Link
                          href={`/app/portfoyler/${property.id}`}
                          className="relative z-10 mt-1.5 inline-block max-w-full truncate align-top text-xs text-text-muted transition hover:text-brand-600 hover:underline"
                        >
                          {propertyName}
                        </Link>
                      ) : (
                        <p className="mt-1.5 truncate text-xs text-text-muted">{propertyName}</p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-faint">
                        {appt.location ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {appt.location}</span> : null}
                        {appt.duration_min ? <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {appt.duration_min} dk</span> : null}
                      </div>
                    </div>
                    <div className="relative z-10 flex items-center gap-2 md:flex-col md:items-end">
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
                        {appt.customer_response && responseMeta[appt.customer_response] ? (
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${responseMeta[appt.customer_response].cls}`}>
                            {responseMeta[appt.customer_response].label}
                          </span>
                        ) : null}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {appt.status === "pending" ? (
                          <form action={setAppointmentStatus}>
                            <input type="hidden" name="id" value={appt.id} />
                            <input type="hidden" name="status" value="confirmed" />
                            <button type="submit" className="inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-mint-600 transition hover:border-mint-500/40"><CheckCircle2 className="h-3 w-3" /> Onayla</button>
                          </form>
                        ) : null}
                        {appt.status !== "completed" ? (
                          <form action={setAppointmentStatus}>
                            <input type="hidden" name="id" value={appt.id} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" className="inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300"><CheckCircle2 className="h-3 w-3" /> Tamamlandı</button>
                          </form>
                        ) : null}
                        {appt.status !== "completed" ? (
                          <AppointmentEditDialog
                            appointment={{ id: appt.id, appointment_type: appt.appointment_type, scheduled_at: appt.scheduled_at, duration_min: appt.duration_min, location: appt.location, notes: appt.notes }}
                            typeOptions={appointmentTypeOptions}
                          />
                        ) : null}
                        {appt.status !== "completed" ? (
                          <form action={setAppointmentStatus}>
                            <input type="hidden" name="id" value={appt.id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <button type="submit" className="inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-danger-500 transition hover:border-danger-500/40"><XCircle className="h-3 w-3" /> İptal</button>
                          </form>
                        ) : null}
                        {/* Müşteriye SMS/WhatsApp ile iletilecek teyit linki */}
                        {appt.status !== "completed" && appt.confirm_token ? (
                          <CopyConfirmLink token={appt.confirm_token} />
                        ) : null}
                        {appt.appointment_type === "showing" ? (
                          <Link
                            href={tutanakHref}
                            className="relative z-10 inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
                          >
                            <FileSignature className="h-3 w-3" /> Tutanak oluştur
                          </Link>
                        ) : null}
                        <AddToCalendarButton
                          event={{
                            uid:         appt.id,
                            title:       `${typeLabel[appt.appointment_type] ?? appt.appointment_type} — ${customerName}`,
                            description: `${propertyName}${appt.notes ? `\n${appt.notes}` : ""}`,
                            location:    appt.location ?? undefined,
                            startAt:     date,
                            endAt:       appt.duration_min
                              ? new Date(date.getTime() + appt.duration_min * 60_000)
                              : undefined,
                          }}
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* side: signature + gps */}
        <div className="space-y-4">
          {/* Kişisel ICS abonelik linki — Google/Apple/Outlook otomatik senkron */}
          {calendarToken ? <CalendarSubscribeCard token={calendarToken} /> : null}

          <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-mint-500/12 text-mint-600"><FileSignature className="h-4 w-4" /></span>
              <div>
                <p className="text-xs font-semibold text-mint-600">Yer gösterme takibi</p>
                <h2 className="font-display font-bold text-ink-950">Randevu durumu</h2>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              Yer gösterme ve görüşmelerin durumunu takip edin. Tamamlanan randevular komisyon ve anlaşma akışına kaynak olur.
            </p>
            <div className="mt-4 space-y-2">
              {[
                { label: "Tamamlanan", value: `${rows.filter((r) => r.status === "completed").length} randevu`, icon: CheckCircle2, tone: "text-mint-600", href: apptHref({ durum: "completed" }) },
                { label: "Bekleyen", value: `${pendingSign} randevu`, icon: Clock3, tone: "text-warn-500", href: apptHref({ durum: "signature" }) },
                { label: "Yer gösterme", value: `${showings} adet`, icon: MapPinned, tone: "text-brand-600", href: apptHref({ tip: "showing" }) },
              ].map((row) => (
                <Link key={row.label} href={row.href} className="focus-ring group flex items-center justify-between rounded-[11px] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300">
                  <span className="flex items-center gap-2 text-xs font-medium text-text-muted"><row.icon className={`h-4 w-4 ${row.tone}`} /> {row.label}</span>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink-950">
                    {row.value}
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-mint-500/25 blur-[60px]" />
            <div className="relative flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-400"><MapPinned className="h-4 w-4" /> Günlük tur planı</p>
              <span className="rounded-full bg-mint-400/12 px-2.5 py-1 text-[11px] font-bold text-mint-400">PLAN</span>
            </div>
            <p className="relative mt-3 text-sm text-white/70">Bugün <span className="font-bold text-white">{todayRows.length}</span> randevu planlı. Randevuları saatine göre sıralayıp turunuzu düzenleyin.</p>
            <div className="relative mt-4 flex items-center justify-between rounded-[12px] border border-white/10 bg-white/5 px-4 py-3">
              <div><p className="text-[11px] text-white/45">Yaklaşan yer gösterme</p><p className="font-display text-xl font-extrabold text-mint-400">{showings}</p></div>
              <Navigation className="h-5 w-5 text-white/40" />
            </div>
          </section>

          <section className="rounded-[20px] border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-brand-600" />
              <h2 className="font-display font-bold text-ink-950">Randevu türleri</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {Object.entries(typeLabel).map(([key, label]) => {
                const count = rows.filter((r) => r.appointment_type === key).length;
                const active = tipF === key;
                return (
                  <Link
                    key={key}
                    href={apptHref({ tip: active ? "" : key })}
                    className={`focus-ring press lift group block rounded-[12px] border px-3 py-2.5 transition ${typeTone[key]} ${active ? "border-brand-400" : "border-line hover:border-brand-300"}`}
                  >
                    <p className="flex items-start justify-between font-display text-lg font-extrabold">
                      {count}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60" />
                    </p>
                    <p className="text-[11px] font-medium opacity-80">{label}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
