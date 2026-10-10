import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import Link from "@/components/ui/smart-link";
import type { ReactNode } from "react";
import { ArrowLeftRight, ArrowUpRight, Building2, CalendarDays, FileText, PhoneCall, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone } from "@/lib/phone";
import { now, trDayKey } from "@/lib/clock";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { getStageLabels } from "@/lib/definitions";
import { buildCoachActions } from "@/lib/advisor-coach";
import { CoachPanel, type CoachActionWithLink } from "@/app/app/danisman-kpi/coach-panel";
import { targetPeriodRange } from "@/lib/team/target-actuals";
import { loadTargetActualsLive, type MetricsViewer } from "@/lib/team/advisor-metrics";
import { conversionPct, targetProgressPct } from "@/lib/team/scorecard";
import { summarizeAdvisorEarning, type ShareRow } from "@/lib/team/advisor-share";
import {
  buildTimeline,
  compareMonths,
  openPipeline,
  type Delta,
  type TimelineEvent,
} from "@/lib/team/advisor-360";
import { loadLeadData, type MemberMonth } from "./advisor-data";
import { MemberHandoff } from "./member-handoff";
import type { HandoffScope } from "@/lib/team/handoff";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CommissionRow = ShareRow & { created_at: string };

export type Ctx = {
  supabase: Supabase;
  id: string;
  fullName: string;
  showEarnings: boolean;
  isSelf: boolean;
  /** Kazanç görünürse yıl başından komisyon satırları (aksi halde boş: veri hiç çekilmez). */
  commissions: CommissionRow[];
  /** İzleyici (hedef gerçekleşmesi aynı tek kaynaktan hesaplanır). */
  viewer: MetricsViewer;
  tenantId: string | null;
  /** Bu ay / önceki ay metrikleri (loadAdvisorMetrics; sayfa bir kez yükler). */
  month: MemberMonth;
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));

const SECTION = "rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]";
const ITEM =
  "group flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm transition hover:border-brand-400 hover:bg-brand-600/[0.03]";

function Section({ title, icon, aside, children }: { title: string; icon?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={SECTION}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950">
        {icon} {title} {aside ? <span className="ml-auto text-xs font-normal text-text-muted">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-text-muted">{children}</p>;
}

/** "Önceki ay 4 · +2 (%50)" — önceki ay 0 ise yüzde yazılmaz. */
function deltaHint(prev: number, d: Delta, fmt: (n: number) => string = String): string {
  const sign = d.diff > 0 ? "+" : d.diff < 0 ? "−" : "";
  const pct = d.pct === null ? "" : ` (%${Math.abs(d.pct)})`;
  return `önceki ay ${fmt(prev)} · ${d.diff === 0 ? "aynı" : `${sign}${fmt(Math.abs(d.diff))}${pct}`}`;
}

/* -------------------------------------------------------------------------- */
/* Özet                                                                        */
/* -------------------------------------------------------------------------- */

export async function OverviewTab({ ctx, canHandoff, editableScopes }: { ctx: Ctx; canHandoff: boolean; editableScopes: HandoffScope[] }) {
  const { supabase, id, fullName, showEarnings } = ctx;
  const kpis = ctx.month.kpis;

  const [customersRes, propertyCountRes, propertiesRes, advisorRes] = await Promise.all([
    supabase.from("customers").select("id, full_name, phone").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("assigned_to", id).is("deleted_at", null),
    supabase.from("properties").select("id, property_code, title, list_price").eq("assigned_to", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
    canHandoff
      ? supabase.from("profiles").select("id, full_name").eq("is_active", true).neq("id", id).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const customerCount = ctx.month.customerTotal;
  const propertyCount = propertyCountRes.count ?? 0;
  const customers = (customersRes.data ?? []) as { id: string; full_name: string; phone: string | null }[];
  const properties = (propertiesRes.data ?? []) as { id: string; property_code: string | null; title: string | null; list_price: number | null }[];
  const advisors = (advisorRes.data ?? []) as { id: string; full_name: string }[];

  const convCur = conversionPct(kpis.deals.cur, kpis.offers.cur);
  const convPrev = conversionPct(kpis.deals.prev, kpis.offers.prev);

  const items: StatRowItem[] = [
    { label: "Yeni müşteri (bu ay)", value: kpis.customers.cur, href: `/app/musteriler?assigned=${id}`, hint: deltaHint(kpis.customers.prev, compareMonths(kpis.customers.cur, kpis.customers.prev)), icon: <Users /> },
    { label: "Randevu (bu ay)", value: kpis.appointments.cur, href: `/app/randevular?danisman=${id}`, hint: deltaHint(kpis.appointments.prev, compareMonths(kpis.appointments.cur, kpis.appointments.prev)), icon: <CalendarDays /> },
    { label: "Teklif (bu ay)", value: kpis.offers.cur, href: `/app/teklifler?danisman=${id}`, hint: deltaHint(kpis.offers.prev, compareMonths(kpis.offers.cur, kpis.offers.prev)), icon: <FileText /> },
    { label: "Anlaşma (bu ay)", value: kpis.deals.cur, href: `/app/teklifler?danisman=${id}&durum=accepted`, hint: deltaHint(kpis.deals.prev, compareMonths(kpis.deals.cur, kpis.deals.prev)) },
    {
      label: "Dönüşüm (anlaşma / teklif)",
      value: convCur === null ? "—" : `%${convCur}`,
      href: `/app/teklifler?danisman=${id}`,
      hint: convPrev === null ? "önceki ay teklif yok" : `önceki ay %${convPrev}`,
    },
  ];
  if (showEarnings) {
    const cur = ctx.month.revenue.cur ?? 0;
    const prev = ctx.month.revenue.prev ?? 0;
    items.push({ label: "Tahsil edilen pay (bu ay)", value: money(cur), href: ctx.isSelf ? "/app/cuzdan" : "/app/cuzdan?sekme=ofis", hint: deltaHint(prev, compareMonths(cur, prev), money) });
  }
  items.push(
    { label: "Müşteri (toplam)", value: customerCount, href: `/app/musteriler?assigned=${id}`, icon: <Users /> },
    { label: "Portföy (toplam)", value: propertyCount, href: `/app/portfoyler?danisman=${id}`, icon: <Building2 /> },
    { label: "Çağrı (bu ay)", value: kpis.callsCur, href: `/app/arama?danisman=${id}`, icon: <PhoneCall /> },
  );

  return (
    <div className="space-y-6">
      <StatRow label="Bu ay ve önceki ay" items={items} />

      {canHandoff ? (
        <Section title="İş yükünü devret" icon={<ArrowLeftRight className="h-4 w-4 text-brand-600" />}>
          <p className="mb-3 text-xs text-text-muted">
            {fullName} ekipten ayrılıyorsa müşteri, portföy, açık anlaşma, görev ve randevularını başka bir danışmana aktarın; hiçbir kayıt sahipsiz kalmasın.
          </p>
          <MemberHandoff fromId={id} fromName={fullName} advisors={advisors} editableScopes={editableScopes} />
        </Section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Müşteriler" icon={<Users className="h-4 w-4 text-brand-600" />} aside={customerCount}>
          {customers.length === 0 ? (
            <Empty>Atanmış müşteri yok.</Empty>
          ) : (
            <>
              <ul className="space-y-1.5">
                {customers.map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/musteriler/${c.id}`} className={ITEM}>
                      <span className="font-medium text-ink-950 group-hover:text-brand-600">{c.full_name}</span>
                      <span className="text-xs text-text-muted">{c.phone ? formatTurkishPhone(c.phone) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={`/app/musteriler?assigned=${id}`} className="focus-ring mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                Tümünü gör ({customerCount}) <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </Section>

        <Section title="Portföyler" icon={<Building2 className="h-4 w-4 text-mint-600" />} aside={propertyCount}>
          {properties.length === 0 ? (
            <Empty>Atanmış portföy yok.</Empty>
          ) : (
            <>
              <ul className="space-y-1.5">
                {properties.map((p) => (
                  <li key={p.id}>
                    <Link href={`/app/portfoyler/${p.id}`} className={ITEM}>
                      <span className="min-w-0 truncate font-medium text-ink-950 group-hover:text-brand-600">{p.title ?? p.property_code}</span>
                      <span className="shrink-0 text-xs text-text-muted">{p.list_price ? money(Number(p.list_price)) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={`/app/portfoyler?danisman=${id}`} className="focus-ring mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                Tümünü gör ({propertyCount}) <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Aktivite                                                                    */
/* -------------------------------------------------------------------------- */

const KIND_META: Record<TimelineEvent["kind"], { label: string; tone: string }> = {
  call: { label: "Çağrı", tone: "bg-amber-400/15 text-amber-700" },
  appointment: { label: "Randevu", tone: "bg-cyan-500/15 text-cyan-700" },
  task: { label: "Görev", tone: "bg-brand-600/10 text-brand-700" },
  offer: { label: "Teklif", tone: "bg-mint-500/15 text-mint-700" },
};

const CALL_DIR: Record<string, string> = { inbound: "Gelen çağrı", outbound: "Giden çağrı", missed: "Cevapsız çağrı" };
const APPT_TYPE = APPOINTMENT_TYPE_LABELS;
const TASK_STATUS: Record<string, string> = { open: "açık", done: "tamamlandı", cancelled: "iptal" };

type Rel = { full_name?: string | null; title?: string | null } | { full_name?: string | null; title?: string | null }[] | null;
const relOf = (v: Rel) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function ActivityTab({ ctx }: { ctx: Ctx }) {
  const { supabase, id } = ctx;
  const [calls, appts, tasks, offers] = await Promise.all([
    supabase.from("calls").select("id, direction, started_at, customer_id, customer:customers!calls_customer_id_fkey(full_name)").eq("handled_by", id).order("started_at", { ascending: false }).limit(15),
    supabase.from("appointments").select("id, appointment_type, status, scheduled_at, customer_id, customer:customers!appointments_customer_id_fkey(full_name)").eq("assigned_to", id).order("scheduled_at", { ascending: false }).limit(15),
    supabase.from("tasks").select("id, title, status, created_at, completed_at, customer_id, customer:customers!tasks_customer_id_fkey(full_name)").eq("assigned_to", id).order("created_at", { ascending: false }).limit(15),
    supabase.from("offers").select("id, status, created_at, customer:customers!offers_customer_id_fkey(full_name), property:properties!offers_property_id_fkey(title)").eq("created_by", id).order("created_at", { ascending: false }).limit(15),
  ]);

  const events: TimelineEvent[] = [];
  for (const c of (calls.data ?? []) as unknown as { id: string; direction: string; started_at: string; customer_id: string | null; customer: Rel }[]) {
    events.push({ key: `call-${c.id}`, kind: "call", title: CALL_DIR[c.direction] ?? "Çağrı", sub: relOf(c.customer)?.full_name ?? null, at: c.started_at, href: c.customer_id ? `/app/musteriler/${c.customer_id}` : `/app/arama?danisman=${id}` });
  }
  for (const a of (appts.data ?? []) as unknown as { id: string; appointment_type: string; status: string; scheduled_at: string; customer_id: string | null; customer: Rel }[]) {
    events.push({ key: `appt-${a.id}`, kind: "appointment", title: APPT_TYPE[a.appointment_type] ?? "Randevu", sub: relOf(a.customer)?.full_name ?? null, at: a.scheduled_at, href: `/app/randevular?danisman=${id}` });
  }
  for (const t of (tasks.data ?? []) as unknown as { id: string; title: string; status: string; created_at: string; completed_at: string | null; customer_id: string | null; customer: Rel }[]) {
    const name = relOf(t.customer)?.full_name;
    events.push({
      key: `task-${t.id}`,
      kind: "task",
      title: t.title,
      sub: [TASK_STATUS[t.status] ?? t.status, name].filter(Boolean).join(" · "),
      at: t.status === "done" && t.completed_at ? t.completed_at : t.created_at,
      href: t.customer_id ? `/app/musteriler/${t.customer_id}` : `/app/gorevler?filter=all&q=${encodeURIComponent(t.title.slice(0, 40))}`,
    });
  }
  for (const o of (offers.data ?? []) as unknown as { id: string; status: string; created_at: string; customer: Rel; property: Rel }[]) {
    events.push({ key: `offer-${o.id}`, kind: "offer", title: `Teklif: ${relOf(o.property)?.title ?? "portföy"}`, sub: relOf(o.customer)?.full_name ?? null, at: o.created_at, href: `/app/teklifler/${o.id}` });
  }

  const timeline = buildTimeline(events, 30);
  if (timeline.length === 0) {
    return <EmptyStateV3 title="Henüz etkinlik yok" description="Çağrı, randevu, görev ve teklif kayıtları oluştukça burada zaman çizelgesi olarak görünür." />;
  }
  return (
    <Section title="Son etkinlikler" aside="çağrı, randevu, görev, teklif">
      <ol className="space-y-1.5">
        {timeline.map((e) => (
          <li key={e.key}>
            <Link href={e.href} className={ITEM}>
              <span className="flex min-w-0 items-center gap-3">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_META[e.kind].tone}`}>{KIND_META[e.kind].label}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-950 group-hover:text-brand-600">{e.title}</span>
                  {e.sub ? <span className="block truncate text-xs text-text-muted">{e.sub}</span> : null}
                </span>
              </span>
              <time dateTime={e.at} className="shrink-0 text-xs text-text-muted">{dateTime(e.at)}</time>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Öncül göstergeler                                                           */
/* -------------------------------------------------------------------------- */

export async function LeadTab({ ctx }: { ctx: Ctx }) {
  const { supabase, id, isSelf } = ctx;
  const lead = await loadLeadData(supabase, id);
  // Görev listesi başkası adına filtrelenemez (yalnız "benim" filtresi var): başkası için satır içi liste + bağlantılar.
  const taskHref = (filter: string, anchor: string) => (isSelf ? `/app/gorevler?filter=${filter}&mine=1` : `#${anchor}`);

  const items: StatRowItem[] = [
    { label: "Gecikmiş görev", value: lead.overdueTasks, href: taskHref("overdue", "gecikmis"), attention: true, hint: "vadesi geçmiş açık görev" },
    { label: "Bugün yapılacak görev", value: lead.todayTasks, href: taskHref("today", "bugun") },
    { label: "Bugünkü randevu", value: lead.todayAppointments, href: `/app/randevular?danisman=${id}` },
    { label: "30+ gündür dokunulmayan müşteri", value: lead.staleCustomers, href: `/app/musteriler?assigned=${id}`, attention: true, hint: "son güncelleme 30 günden eski" },
  ];
  if (!lead.untrackedPartial) {
    items.push({ label: "Takipsiz talep", value: lead.untracked.count, href: `/app/talepler?danisman=${id}`, attention: true, hint: "açık görevi olmayan açık talep" });
  }

  const taskList = (title: string, anchor: string, rows: LeadDataTasks) => (
    <section id={anchor} className={`${SECTION} scroll-mt-24`}>
      <h2 className="mb-3 text-sm font-bold text-ink-950">{title}</h2>
      {rows.length === 0 ? (
        <Empty>Kayıt yok.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={t.customer_id ? `/app/musteriler/${t.customer_id}` : `/app/gorevler?filter=all&q=${encodeURIComponent(t.title.slice(0, 40))}`} className={ITEM}>
                <span className="min-w-0 truncate font-medium text-ink-950 group-hover:text-brand-600">{t.title}</span>
                <time dateTime={t.due_at} className="shrink-0 text-xs text-text-muted">{dateTime(t.due_at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <StatRow label="Erken işaretler" items={items} />
      <p className="text-xs text-text-faint">
        Erken işaretler sonucu (anlaşma, kazanç) beklemeden ritmi gösterir. İlk yanıt süresi için müşteri bazında güvenilir bir kayıt bulunmadığından gösterilmez.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {taskList("Gecikmiş görevler", "gecikmis", lead.overdueSample)}
        {taskList("Bugün yapılacaklar", "bugun", lead.todaySample)}
      </div>
      {lead.untrackedPartial ? (
        <p className="text-xs text-text-muted">Takipsiz talep sayısı bu danışmanda tarama sınırını aştığı için hesaplanamadı.</p>
      ) : lead.untracked.sample.length > 0 ? (
        <Section title="Takipsiz talepler" aside={`${lead.untracked.count} müşteri`}>
          <ul className="space-y-1.5">
            {lead.untracked.sample.map((c) => (
              <li key={c.id}>
                <Link href={`/app/musteriler/${c.id}`} className={ITEM}>
                  <span className="font-medium text-ink-950 group-hover:text-brand-600">{c.name}</span>
                  <span className="text-xs text-text-muted">açık görev yok</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

type LeadDataTasks = { id: string; title: string; due_at: string; customer_id: string | null }[];

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

export async function PipelineTab({ ctx }: { ctx: Ctx }) {
  const { supabase, id } = ctx;
  const [dealsRes, stageLabels] = await Promise.all([
    supabase
      .from("deals")
      .select("id, stage, deal_value, updated_at, property:properties!deals_property_id_fkey(title), customer:customers!deals_customer_id_fkey(full_name)", { count: "exact" })
      .eq("assigned_to", id)
      .not("stage", "in", "(won,lost)")
      .order("updated_at", { ascending: false })
      .limit(500),
    getStageLabels(),
  ]);
  const deals = (dealsRes.data ?? []) as unknown as { id: string; stage: string; deal_value: number | null; updated_at: string; property: Rel; customer: Rel }[];
  if (deals.length === 0) {
    return <EmptyStateV3 title="Açık anlaşma yok" description="Bu danışmana atanmış açık anlaşma bulunmuyor." action={{ href: "/app/anlasmalar/yeni", label: "Anlaşma başlat" }} secondary={{ href: `/app/anlasmalar?danisman=${id}&gorunum=liste`, label: "Tüm anlaşmaları gör" }} />;
  }
  const stages = openPipeline(deals);
  const items: StatRowItem[] = stages.map((s) => ({
    label: stageLabels[s.stage as keyof typeof stageLabels]?.label ?? s.stage,
    value: s.count,
    href: `/app/anlasmalar?danisman=${id}&gorunum=liste&asama=${s.stage}`,
    hint: s.value > 0 ? money(s.value) : undefined,
  }));
  return (
    <div className="space-y-6">
      <StatRow label="Açık anlaşma aşamaları" items={items} />
      <Section title="Açık anlaşmalar" aside={`${dealsRes.count ?? deals.length} kayıt`}>
        <ul className="space-y-1.5">
          {deals.slice(0, 12).map((d) => (
            <li key={d.id}>
              <Link href={`/app/anlasmalar/${d.id}`} className={ITEM}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-950 group-hover:text-brand-600">{relOf(d.property)?.title ?? "Anlaşma"}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {[stageLabels[d.stage as keyof typeof stageLabels]?.label ?? d.stage, relOf(d.customer)?.full_name].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">{d.deal_value ? money(Number(d.deal_value)) : "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href={`/app/anlasmalar?danisman=${id}&gorunum=liste&asama=acik`} className="focus-ring mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
          Tümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hedef                                                                       */
/* -------------------------------------------------------------------------- */

const PERIOD_LABEL: Record<string, string> = { monthly: "Aylık", quarterly: "Çeyreklik", yearly: "Yıllık" };

export async function TargetTab({ ctx }: { ctx: Ctx }) {
  const { supabase, id, showEarnings } = ctx;
  const nowMs = now();
  const { data } = await supabase
    .from("targets")
    .select("id, period, period_start, target_deals, target_revenue, profile_id")
    .eq("profile_id", id)
    .order("period_start", { ascending: false })
    .limit(24);
  const targets = ((data ?? []) as { id: string; period: string; period_start: string; target_deals: number; target_revenue: number; profile_id: string | null }[]).filter((t) => {
    const r = targetPeriodRange(t.period_start, t.period);
    return nowMs >= r.start && nowMs < r.end;
  });
  if (targets.length === 0) {
    return (
      <EmptyStateV3
        title="Bu dönem için hedef yok"
        description="Danışmana atanmış, içinde bulunulan dönemi kapsayan bir hedef bulunmuyor."
        action={<Link href="/app/hedefler" className="focus-ring text-sm font-semibold text-brand-600 hover:underline">Hedefler sayfası</Link>}
      />
    );
  }
  // Gerçekleşme: TEK KAYNAK (advisor-metrics): anlaşma = kabul edilen teklif, gelir = tahsil edilen komisyon payı.
  const actualsLive = await loadTargetActualsLive(supabase, {
    viewer: ctx.viewer,
    tenantId: ctx.tenantId,
    targets,
    names: new Map([[id, ctx.fullName]]),
  });
  const actuals = new Map([...actualsLive].map(([k, v]) => [k, { deals: v.deals, revenue: v.revenue }]));

  return (
    <div className="space-y-4">
      {targets.map((t) => {
        const a = actuals.get(t.id) ?? { deals: 0, revenue: 0 };
        const pct = targetProgressPct({ deals: Number(t.target_deals) || 0, revenue: Number(t.target_revenue) || 0 }, a, showEarnings);
        return (
          <Link key={t.id} href="/app/hedefler" className={`${SECTION} block transition hover:border-brand-300`}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-ink-950">{PERIOD_LABEL[t.period] ?? t.period} hedef</p>
              <span className="font-display text-lg font-extrabold text-brand-700">{pct === null ? "—" : `%${pct}`}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-950/8" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-[image:var(--grad-brand)]" style={{ width: `${pct ?? 0}%` }} />
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
              <div>
                <dt>Anlaşma</dt>
                <dd className="text-sm font-semibold text-ink-950">{a.deals} / {t.target_deals}</dd>
              </div>
              {showEarnings ? (
                <div>
                  <dt>Gelir (tahsil edilen komisyon payı)</dt>
                  <dd className="text-sm font-semibold text-ink-950">{money(a.revenue)} / {money(Number(t.target_revenue) || 0)}</dd>
                </div>
              ) : null}
            </dl>
          </Link>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Kazanç (yalnız earnings_all veya kendi)                                     */
/* -------------------------------------------------------------------------- */

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function EarningsTab({ ctx, year }: { ctx: Ctx; year: string }) {
  const { commissions, fullName, id, isSelf } = ctx;
  const total = summarizeAdvisorEarning(commissions, fullName, id);
  if (total.count === 0) {
    return <EmptyStateV3 title="Bu yıl kazanç kaydı yok" description={`${year} yılında bu danışmanın payı olan komisyon kaydı bulunmuyor.`} />;
  }
  const rows = MONTHS.map((label, i) => {
    const sel = commissions.filter((c) => {
      const m = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(c.created_at)));
      return m === i + 1;
    });
    return { label, e: summarizeAdvisorEarning(sel, fullName, id) };
  }).filter((r) => r.e.count > 0);
  const link = isSelf ? "/app/cuzdan" : "/app/cuzdan?sekme=ofis";
  return (
    <div className="space-y-6">
      <StatRow
        label="Kazanç özeti"
        items={[
          { label: `${year} tahsil edilen pay`, value: money(total.collected), href: link },
          { label: "Bekleyen pay (tahmini)", value: money(total.pending), href: "/app/komisyon" },
          { label: "Komisyon kaydı", value: total.count, href: "/app/komisyon" },
        ]}
      />
      <Section title="Aylara göre pay" aside="komisyon kaydının oluştuğu aya göre">
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label}>
              <Link href={link} className={ITEM}>
                <span className="font-medium text-ink-950">{r.label}</span>
                <span className="text-xs text-text-muted">
                  tahsil {money(r.e.collected)} · bekleyen {money(r.e.pending)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <p className="text-xs text-text-faint">Pay, komisyon dağılımında danışmanın adına yazılan oran üzerinden hesaplanır; danışmana ödeme (hakediş) ayrı bir kayıt değildir.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Koçluk                                                                      */
/* -------------------------------------------------------------------------- */

export async function CoachTab({ ctx }: { ctx: Ctx }) {
  const { supabase, id, fullName } = ctx;
  const kpis = ctx.month.kpis;
  const todayIso = new Date(now()).toISOString();
  const [lead, overpriced, expiring] = await Promise.all([
    loadLeadData(supabase, id),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("assigned_to", id).is("deleted_at", null).eq("price_health", "red"),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", id)
      .is("deleted_at", null)
      .gte("authorization_end", trDayKey(todayIso))
      .lte("authorization_end", trDayKey(now() + 15 * 86_400_000)),
  ]);
  const actions: CoachActionWithLink[] = buildCoachActions({
    customerCount: ctx.month.customerTotal,
    callCount: kpis.callsCur,
    appointmentCount: kpis.appointments.cur,
    offerCount: kpis.offers.cur,
    dealCount: kpis.deals.cur,
    revenue: ctx.month.revenue.cur ?? 0,
    staleCustomerCount: lead.staleCustomers,
    hotCustomerCount: 0,
    overpricedCount: overpriced.count ?? 0,
    expiringAuthCount: expiring.count ?? 0,
    overdueTaskCount: lead.overdueTasks,
  }).map((a) => ({ ...a, ...coachHref(a.title, id, ctx.isSelf) }));

  if (actions.length === 0) {
    return <EmptyStateV3 title="Şimdilik öneri yok" description="Kural tabanlı koç, bu ay için öne çıkan bir aksiyon bulmadı." />;
  }
  return <CoachPanel actions={actions} adSoyad={fullName} />;
}

function coachHref(title: string, id: string, isSelf: boolean): { href?: string; hrefLabel?: string } {
  const t = title.toLocaleLowerCase("tr");
  if (t.includes("yetki")) return { href: `/app/portfoyler?danisman=${id}`, hrefLabel: "Portföyler" };
  if (t.includes("görev")) return isSelf ? { href: "/app/gorevler?filter=overdue&mine=1", hrefLabel: "Gecikmiş görevler" } : { href: `/app/ekip/${id}?sekme=oncul`, hrefLabel: "Erken işaretler" };
  if (t.includes("randevu")) return { href: `/app/randevular?danisman=${id}`, hrefLabel: "Randevular" };
  if (t.includes("teklif")) return { href: `/app/teklifler?danisman=${id}`, hrefLabel: "Teklifler" };
  if (t.includes("anlaşma")) return { href: `/app/anlasmalar?danisman=${id}`, hrefLabel: "Anlaşmalar" };
  if (t.includes("çağrı") || t.includes("huni")) return { href: `/app/arama?danisman=${id}`, hrefLabel: "Çağrı kayıtları" };
  if (t.includes("piyasa üstü")) return { href: `/app/portfoyler?danisman=${id}`, hrefLabel: "Portföyler" };
  return { href: `/app/musteriler?assigned=${id}`, hrefLabel: "Müşteriler" };
}
