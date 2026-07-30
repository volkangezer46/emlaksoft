import Link from "next/link";
import { Sunrise, CalendarClock, ListChecks, ShieldAlert, Flame, ArrowUpRight, MapPin, Clock3 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";

export const metadata = { title: "Günlük Brifing" };

type Rel = { full_name?: string } | { full_name?: string }[] | null;
const relName = (r: Rel): string => (Array.isArray(r) ? r[0]?.full_name : r?.full_name) ?? "";
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date(iso));

export default async function BrifingPage() {
  const { userId, role } = await requireModulePage("dashboard");
  const supabase = await createClient();
  const officeWide = ["owner", "gm", "branch_manager"].includes(role);

  let apptQ = supabase
    .from("appointments")
    .select("id, appointment_type, scheduled_at, location, customer:customers(full_name)")
    .gte("scheduled_at", daysAgoIso(0))
    .lte("scheduled_at", daysFromNowIso(2))
    .in("status", ["pending", "confirmed"])
    .order("scheduled_at", { ascending: true })
    .limit(12);
  let taskQ = supabase
    .from("tasks")
    .select("id, title, due_at, priority, customer:customers(full_name)")
    .eq("status", "open")
    .lte("due_at", daysFromNowIso(1))
    .order("due_at", { ascending: true })
    .limit(12);
  let expQ = supabase
    .from("properties")
    .select("id, property_code, title, authorization_end")
    .eq("status", "live")
    .not("authorization_end", "is", null)
    .gte("authorization_end", daysAgoIso(0).slice(0, 10))
    .lte("authorization_end", daysFromNowIso(14).slice(0, 10))
    .order("authorization_end", { ascending: true })
    .limit(12);
  if (!officeWide) {
    apptQ = apptQ.eq("assigned_to", userId);
    taskQ = taskQ.eq("assigned_to", userId);
    expQ = expQ.eq("assigned_to", userId);
  }
  const [{ data: appts }, { data: tasks }, { data: expiring }] = await Promise.all([apptQ, taskQ, expQ]);

  const apptRows = (appts ?? []) as { id: string; appointment_type: string | null; scheduled_at: string; location: string | null; customer: Rel }[];
  const taskRows = (tasks ?? []) as { id: string; title: string; due_at: string | null; priority: string; customer: Rel }[];
  const expRows = (expiring ?? []) as { id: string; property_code: string; title: string; authorization_end: string }[];

  const APPT_TR: Record<string, string> = { showing: "Gösterim", office: "Ofis görüşmesi", valuation: "Değerleme", signing: "İmza", other: "Görüşme" };

  const total = apptRows.length + taskRows.length + expRows.length;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[70px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <Sunrise className="h-4 w-4" /> {officeWide ? "Ofis brifingi" : "Güne başla"}
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Günlük Brifing</h1>
          <p className="mt-1 max-w-xl text-sm text-white/70">
            {total > 0
              ? `Bugün odaklanman gereken ${total} madde: yaklaşan randevular, geciken görevler ve süresi dolan yetkiler.`
              : "Bugün acil bir madde yok — sıcak müşterilere dokunmak için harika bir gün."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />{apptRows.length} randevu</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"><ListChecks className="mr-1 inline h-3.5 w-3.5" />{taskRows.length} görev</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />{expRows.length} yetki bitişi</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Randevular */}
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950"><CalendarClock className="h-4.5 w-4.5 text-brand-600" /> Yaklaşan randevular <span className="text-text-faint">· 48s</span></h2>
          {apptRows.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line bg-canvas/60 px-3 py-5 text-center text-sm text-text-muted">Yaklaşan randevu yok.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {apptRows.map((a) => (
                <li key={a.id} className="rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-ink-950">{relName(a.customer) || "—"}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                    <span className="font-medium text-brand-600">{APPT_TR[a.appointment_type ?? "other"] ?? "Görüşme"}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{fmtDateTime(a.scheduled_at)}</span>
                    {a.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/randevular" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Tüm randevular <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </section>

        {/* Görevler */}
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950"><ListChecks className="h-4.5 w-4.5 text-mint-600" /> Bugün & geciken görevler</h2>
          {taskRows.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line bg-canvas/60 px-3 py-5 text-center text-sm text-text-muted">Bekleyen görev yok 👏</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {taskRows.map((t) => (
                <li key={t.id} className="flex items-start gap-2 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.priority === "high" ? "bg-danger-500" : t.priority === "normal" ? "bg-amber-400" : "bg-slate-400"}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{t.title}</p>
                    <p className="text-xs text-text-muted">{relName(t.customer) ? `${relName(t.customer)} · ` : ""}{t.due_at ? fmtDateTime(t.due_at) : "tarihsiz"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/gorevler" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Tüm görevler <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </section>

        {/* Yetki bitişleri */}
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950"><ShieldAlert className="h-4.5 w-4.5 text-amber-500" /> Yetkisi dolan portföyler <span className="text-text-faint">· 14 gün</span></h2>
          {expRows.length === 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line bg-canvas/60 px-3 py-5 text-center text-sm text-text-muted">Yakında dolan yetki yok.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {expRows.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/portfoyler/${p.id}`} className="group flex items-center gap-2 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5 transition hover:border-brand-300">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">{p.title}</p>
                      <p className="text-xs text-text-muted">{p.property_code} · yetki biter: {fmtDate(p.authorization_end)}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-brand-600" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Sıcak müşteri köprüsü */}
      <Link
        href="/app/akilli-listeler"
        className="focus-ring group flex items-center justify-between gap-4 rounded-[18px] border border-brand-600/20 bg-brand-600/5 p-5 transition hover:border-brand-600/40"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600"><Flame className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-bold text-ink-950">Aranacak sıcak müşteriler seni bekliyor</p>
            <p className="text-xs text-text-muted">Akıllı Listeler churn riski, sıcak-randevusuz ve satıcı adaylarını önceliklendirdi.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-[10px] bg-brand-600 px-3 py-2 text-xs font-bold text-white transition group-hover:bg-brand-700">Akıllı Listeler <ArrowUpRight className="h-3.5 w-3.5" /></span>
      </Link>
    </div>
  );
}
