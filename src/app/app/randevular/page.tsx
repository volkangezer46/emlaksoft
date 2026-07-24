import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
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
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { AppointmentCalendar } from "./appointment-calendar";
import Link from "next/link";

type Rel = { id?: string; full_name?: string; title?: string; property_code?: string } | { id?: string; full_name?: string; title?: string; property_code?: string }[] | null;

type AppointmentRow = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  duration_min: number | null;
  location: string | null;
  status: string;
  notes: string | null;
  customer: Rel;
  property: Rel;
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

export default async function AppointmentsPage() {
  await requireModulePage("appointments");
  const supabase = await createClient();
  const [{ data: appts }, { data: customers }, { data: properties }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, appointment_type, scheduled_at, duration_min, location, status, notes, customer:customers(id, full_name), property:properties(id, title, property_code)")
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .limit(100),
    supabase.from("customers").select("id, full_name").is("deleted_at", null).order("full_name"),
    supabase.from("properties").select("id, title, property_code").is("deleted_at", null).order("created_at", { ascending: false }),
  ]);

  const rows = (appts ?? []) as AppointmentRow[];
  const customerOptions = (customers ?? []).map((c) => ({ id: c.id, label: c.full_name }));
  const propertyOptions = (properties ?? []).map((p) => ({ id: p.id, label: p.title || p.property_code }));

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

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Saha planı canlı</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Randevular & yer gösterme</h1>
            <p className="mt-1 text-sm text-white/60">Yer gösterme, görüşme ve tur planını tek akışta yönetin.</p>
          </div>
          <NewAppointmentDialog customers={customerOptions} properties={propertyOptions} />
        </div>
        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Bugünkü randevu", value: todayRows.length, icon: CalendarDays, tone: "text-cyan-400" },
              { label: "Yer gösterme", value: showings, icon: MapPinned, tone: "text-mint-400" },
              { label: "İmza eksik", value: pendingSign, icon: FileSignature, tone: "text-danger-500" },
            ].map((item) => (
              <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                <item.icon className={`h-4 w-4 ${item.tone}`} />
                <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><CalendarClock className="h-3.5 w-3.5 text-cyan-400" /> Haftalık yoğunluk</p>
              <span className="text-[10px] text-white/45">önümüzdeki 7 gün</span>
            </div>
            <div className="mt-4 flex h-24 items-end gap-2">
              {week.map((w, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[9px] font-bold tabular-nums text-white/55">{w.count || ""}</span>
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className={`bar-live w-full max-w-[18px] rounded-t-[4px] ${w.isToday ? "bg-[image:var(--grad-brand)] shadow-[0_0_12px_-1px_rgba(20,99,255,0.7)]" : "bg-white/25"}`}
                      style={{ height: `${Math.max((w.count / maxWeek) * 100, 6)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                  <span className={`text-[9px] ${w.isToday ? "font-bold text-cyan-300" : "text-white/40"}`}>{w.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Takvim görünümü */}
      <AppointmentCalendar
        appointments={rows.map((r) => ({
          id: r.id,
          scheduled_at: r.scheduled_at,
          appointment_type: r.appointment_type,
          status: r.status,
        }))}
      />

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {/* timeline */}
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><CalendarClock className="h-4 w-4" /> Tur planı</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Yaklaşan randevular</h2>
            </div>
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">{rows.length} kayıt</span>
          </div>

          {rows.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-brand-600/10 text-brand-600"><CalendarDays className="h-7 w-7" /></span>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-950">Henüz randevu yok</h3>
              <p className="mt-1 max-w-sm text-sm text-text-muted">İlk yer gösterme veya görüşmenizi planladığınızda tur planı burada oluşacak.</p>
            </div>
          ) : (
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
                return (
                  <article key={appt.id} className="group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] md:grid-cols-[64px_1fr_auto] md:items-center">
                    {cardHref ? (
                      <Link href={cardHref} className="absolute inset-0" aria-label={`${customerName} randevusu detayı`} />
                    ) : null}
                    <div className="flex flex-col items-center justify-center rounded-[12px] border border-line bg-canvas py-2">
                      <span className="font-display text-base font-extrabold tabular-nums text-ink-950">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date)}</span>
                      <span className="text-[9px] uppercase tracking-wide text-text-faint">{new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(date)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-800 text-[10px] font-bold text-white">{initials(customerName)}</span>
                        <p className="text-sm font-semibold text-ink-950">{customerName}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeTone[appt.appointment_type] ?? typeTone.showing}`}>{typeLabel[appt.appointment_type] ?? appt.appointment_type}</span>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-text-muted">{propertyName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-faint">
                        {appt.location ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {appt.location}</span> : null}
                        {appt.duration_min ? <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {appt.duration_min} dk</span> : null}
                      </div>
                    </div>
                    <div className="relative z-10 flex items-center gap-2 md:flex-col md:items-end">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
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
          )}
        </section>

        {/* side: signature + gps */}
        <div className="space-y-4">
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
                { label: "Tamamlanan", value: `${rows.filter((r) => r.status === "completed").length} randevu`, icon: CheckCircle2, tone: "text-mint-600" },
                { label: "Bekleyen", value: `${pendingSign} randevu`, icon: Clock3, tone: "text-warn-500" },
                { label: "Yer gösterme", value: `${showings} adet`, icon: MapPinned, tone: "text-brand-600" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between rounded-[11px] border border-line bg-canvas px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium text-text-muted"><row.icon className={`h-4 w-4 ${row.tone}`} /> {row.label}</span>
                  <span className="text-xs font-bold text-ink-950">{row.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-mint-500/25 blur-[60px]" />
            <div className="relative flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-400"><MapPinned className="h-4 w-4" /> Günlük tur planı</p>
              <span className="rounded-full bg-mint-400/12 px-2.5 py-1 text-[10px] font-bold text-mint-400">PLAN</span>
            </div>
            <p className="relative mt-3 text-sm text-white/70">Bugün <span className="font-bold text-white">{todayRows.length}</span> randevu planlı. Randevuları saatine göre sıralayıp turunuzu düzenleyin.</p>
            <div className="relative mt-4 flex items-center justify-between rounded-[12px] border border-white/10 bg-white/5 px-4 py-3">
              <div><p className="text-[10px] text-white/45">Yaklaşan yer gösterme</p><p className="font-display text-xl font-extrabold text-mint-400">{showings}</p></div>
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
                return (
                  <div key={key} className={`rounded-[12px] border border-line px-3 py-2.5 ${typeTone[key]}`}>
                    <p className="font-display text-lg font-extrabold">{count}</p>
                    <p className="text-[11px] font-medium opacity-80">{label}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
