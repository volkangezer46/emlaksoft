import { MANAGEMENT_TIER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarClock, CalendarDays, CheckCircle2, Columns3, List, PieChart, Plus, Sunrise } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, daysFromNowIso, now, shiftMonthKey, trDayKey, trDayStartMs, trMonthKey, trMonthStartMsFromKey } from "@/lib/clock";
import { isMonthKey } from "@/lib/month-grid";
import { DEAL_OPTION_SELECT, dealOptionLabel, type DealOptionSource } from "@/lib/deal-option-label";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportTasksCsv } from "@/app/actions/export";
import { TaskCalendar, type CalendarTask } from "./task-calendar";
import { QuickTask } from "./quick-task";
import { TaskCard, type TaskRow } from "./task-card";
import { TaskBulkList } from "./task-bulk-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ICONS } from "@/lib/icons";
import { ColumnChartCard, DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { ButtonLink } from "@/components/ui/button";
import { applyScopeFilter, getListScope } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { orIlike } from "@/lib/pgrst";
import { buildHref } from "@/lib/ui/filter-params";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  ViewSwitcher,
  buildActiveChips,
  mergeResetPage,
  pageWindow,
  parsePage,
  type KpiItem,
} from "@/components/ui/list-kit";

export const metadata = { title: "Görevler" };

export const dynamic = "force-dynamic";

const PATH = "/app/gorevler";

/** Sayfa başına görev — gerçek sayfalama (blind .limit yerine). */
const PAGE_SIZE = 50;

const FILTERS = [
  { key: "open", label: "Açık" },
  { key: "overdue", label: "Gecikmiş" },
  { key: "today", label: "Bugün" },
  { key: "yaklasan", label: "Yaklaşan (7 gün)" },
  { key: "done", label: "Tamamlanan" },
  { key: "all", label: "Tümü" },
];

// ?tur= filtre çipleri — değerler tasks.kind kolonundaki gerçek değerler.
const KIND_FILTERS = [
  { key: "call", label: "Arama" },
  { key: "visit", label: "Ziyaret" },
  { key: "document", label: "Evrak" },
  { key: "followup", label: "Takip" },
];

// Zaman okuması clock.ts üzerinden (render'da doğrudan Date.now/new Date yok)
function startOfToday() {
  // Türkiye gün başı (sunucu UTC'de olsa da doğru gün)
  return new Date(trDayStartMs(now()));
}
function endOfToday() {
  return new Date(trDayStartMs(now()) + DAY_MS - 1);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string; filter?: string; mine?: string; tur?: string; tekrar?: string; sayfa?: string; yeni?: string; danisman?: string;
    gorunum?: string; ay?: string; gun?: string; zincir?: string; anlasma?: string;
  }>;
}) {
  const ctx = await requireModulePage("tasks");
  const canEdit = (ctx.perms.tasks ?? []).includes("edit");
  const canDelete = (ctx.perms.tasks ?? []).includes("delete");
  const canCreate = (ctx.perms.tasks ?? []).includes("create");
  const params = (await searchParams) ?? {};
  if (params.yeni === "1") redirect("/app/gorevler/yeni");
  const filter = FILTERS.some((f) => f.key === params.filter) ? params.filter! : "open";
  const mine = params.mine === "1";
  const tur = KIND_FILTERS.some((k) => k.key === params.tur) ? params.tur! : "";
  const tekrar = params.tekrar === "1";
  // Danışman filtresi (yönetim katmanı): ?danisman=<profil id>
  const isManager = MANAGEMENT_TIER_ROLES.includes(ctx.role as TeamRole);
  const danismanF = isManager && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.danisman ?? "") ? params.danisman! : "";
  const q = (params.q ?? "").trim().slice(0, 80);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Görünüm: liste (varsayılan) | kanban (durum sütunları) | takvim (vade, ay ızgarası).
  const gorunum = params.gorunum === "kanban" || params.gorunum === "takvim" ? params.gorunum : "liste";
  const ay = isMonthKey(params.ay) ? params.ay : trMonthKey(now());
  const gun = /^\d{4}-\d{2}-\d{2}$/.test(params.gun ?? "") ? params.gun! : "";
  const zincir = UUID_RE.test(params.zincir ?? "") ? params.zincir! : "";
  const anlasma = UUID_RE.test(params.anlasma ?? "") ? params.anlasma! : "";
  const page = parsePage(params.sayfa);
  const offset = (page - 1) * PAGE_SIZE;

  // Doğrulanmış URL durumu — varsayılan (açık) görünüm param taşımaz.
  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (filter !== "open") urlParams.filter = filter;
  if (tur) urlParams.tur = tur;
  if (tekrar) urlParams.tekrar = "1";
  if (mine) urlParams.mine = "1";
  if (danismanF) urlParams.danisman = danismanF;
  if (gun) urlParams.gun = gun;
  if (zincir) urlParams.zincir = zincir;
  if (anlasma) urlParams.anlasma = anlasma;
  if (gorunum !== "liste") urlParams.gorunum = gorunum;
  if (gorunum === "takvim" && params.ay && isMonthKey(params.ay)) urlParams.ay = ay;
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = urlParams;

  const supabase = await createClient();
  const savedViewsPromise = listSavedViews(PATH);
  // Kullanıcı kapsamı (ofis bayrağı açıksa): assigned_to üzerinden, yalnız daraltır; sayaçlar da aynı kapsamla.
  const listScope = await getListScope({ userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role });
  const scoped = <Q,>(q: Q): Q => applyScopeFilter(q, listScope.filter, { ownerColumn: "assigned_to" });
  // Atama / düzenleme / filtre için ofis üyeleri (kiracı RLS ile sınırlı).
  const [{ data: memberRows }] = await batchAll("Görevler", ["members"], [
    supabase.from("profiles").select("id, full_name").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("full_name").limit(200),
  ]);
  const members = (memberRows ?? []).map((m) => ({ id: m.id as string, name: (m.full_name as string | null) ?? "İsimsiz" }));
  const nowIso = new Date(now()).toISOString();
  const canSeeDeals = (ctx.perms.commissions ?? []).includes("view");
  // Görev seçimi: anlaşma bağı etiketi gömme ile (FK adlı) gelir, kartta dealOptionLabel ile yazılır.
  const TASK_SELECT = `id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, deal_id, recurrence, recurrence_parent_id, created_at, assignee:profiles!tasks_assigned_to_fkey(full_name), customer:customers!tasks_customer_id_fkey(full_name)${canSeeDeals ? `, deal:deals!tasks_deal_id_fkey(${DEAL_OPTION_SELECT})` : ""}`;
  // Ortak filtreler (liste/kanban/takvim aynı kontratı paylaşır): kapsam, atanan, tür, tekrar, arama, gün, zincir.
  const gunStartMs = gun ? Date.parse(`${gun}T00:00:00+03:00`) : Number.NaN;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyBase = (qb: any) => {
    let out = scoped(qb);
    if (mine) out = out.eq("assigned_to", ctx.userId);
    if (danismanF) out = out.eq("assigned_to", danismanF);
    if (tur) out = out.eq("kind", tur);
    if (tekrar) out = out.not("recurrence", "is", null);
    if (q) out = out.or(orIlike(["title", "notes"], q));
    if (zincir) out = out.or(`id.eq.${zincir},recurrence_parent_id.eq.${zincir}`);
    if (anlasma) out = out.eq("deal_id", anlasma);
    if (Number.isFinite(gunStartMs)) {
      out = out.gte("due_at", new Date(gunStartMs).toISOString()).lt("due_at", new Date(gunStartMs + DAY_MS).toISOString());
    }
    return out;
  };

  let query = applyBase(
    supabase
      .from("tasks")
      // count: filtreye göre sayfalama ("X–Y / Toplam Z") gerçek toplamı ister.
      .select(TASK_SELECT, { count: "exact" })
      .eq("tenant_id", ctx.tenantId),
  );

  // Dal yalnız sıralamayı/durumu belirler, .range() aşağıda tek yerde uygulanır (gerçek sayfalama).
  if (filter === "done") {
    query = query.eq("status", "done").order("completed_at", { ascending: false });
  } else if (filter === "overdue") {
    query = query.eq("status", "open").lt("due_at", nowIso).order("due_at", { ascending: true });
  } else if (filter === "yaklasan") {
    // Önümüzdeki 7 gün: bugünden itibaren vadeli açık görevler
    query = query.eq("status", "open").gte("due_at", nowIso).lte("due_at", daysFromNowIso(7)).order("due_at", { ascending: true });
  } else if (filter === "today") {
    query = query
      .eq("status", "open")
      .gte("due_at", startOfToday().toISOString())
      .lte("due_at", endOfToday().toISOString())
      .order("due_at", { ascending: true });
  } else if (filter === "all") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.eq("status", "open").order("due_at", { ascending: true, nullsFirst: false });
  }
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const head = () => scoped(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId));

  const [
    { data: tasksData, count: taskTotal },
    savedViews,
    openRes,
    overdueRes,
    todayRes,
    upcomingRes,
    doneRes,
    allRes,
    ...kindRes
  ] = await batchAll("Görevler", [
    "tasks", "saved-views", "count-open", "count-overdue", "count-today", "count-upcoming", "count-done", "count-all",
    ...KIND_FILTERS.map((k) => `count-kind-${k.key}`),
  ], [
    query,
    savedViewsPromise,
    head().eq("status", "open"),
    head().eq("status", "open").lt("due_at", nowIso),
    head().eq("status", "open").gte("due_at", startOfToday().toISOString()).lte("due_at", endOfToday().toISOString()),
    head().eq("status", "open").gte("due_at", nowIso).lte("due_at", daysFromNowIso(7)),
    head().eq("status", "done"),
    head(),
    // Tür çipi sayaçları: açık görevler içinde
    ...KIND_FILTERS.map((k) => head().eq("status", "open").eq("kind", k.key)),
  ]);

  const counts = {
    open: openRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    today: todayRes.count ?? 0,
    upcoming: upcomingRes.count ?? 0,
    done: doneRes.count ?? 0,
    all: allRes.count ?? 0,
  };
  const kindCounts: Record<string, number> = {};
  KIND_FILTERS.forEach((k, i) => {
    kindCounts[k.key] = (kindRes[i] as { count: number | null }).count ?? 0;
  });

  type RawTask = TaskRow & { deal?: DealOptionSource | DealOptionSource[] | null };
  const withDealLabel = (rows: unknown[] | null | undefined): TaskRow[] =>
    ((rows ?? []) as RawTask[]).map(({ deal, ...t }) => {
      const d = Array.isArray(deal) ? deal[0] : deal;
      return { ...t, deal_label: d ? dealOptionLabel(d) : null };
    });
  const tasks = withDealLabel(tasksData as unknown[]);

  // Anlaşma bağı seçici (düzenleme paneli): son açık anlaşmalar.
  const dealOptions = canSeeDeals && canEdit
    ? (((await supabase
        .from("deals")
        .select(DEAL_OPTION_SELECT)
        .eq("tenant_id", ctx.tenantId)
        .not("stage", "in", "(won,lost)")
        .order("updated_at", { ascending: false })
        .limit(100)).data ?? []) as unknown as DealOptionSource[]).map((d) => ({ id: d.id, label: dealOptionLabel(d) }))
    : undefined;

  // Kanban (durum sütunları) ve takvim (vade) verisi — yalnız o görünüm açıkken çekilir.
  const KANBAN_LIMIT = 50;
  type Lane = { key: string; label: string; tone: string; rows: TaskRow[]; total: number; href: string };
  let lanes: Lane[] = [];
  let calendarTasks: CalendarTask[] = [];
  let calendarTruncated = false;
  if (gorunum === "kanban") {
    const laneQ = () => applyBase(supabase.from("tasks").select(TASK_SELECT, { count: "exact" }).eq("tenant_id", ctx.tenantId));
    const [upcomingLane, overdueLane, doneLane, cancelledLane] = await Promise.all([
      laneQ().eq("status", "open").or(`due_at.is.null,due_at.gte.${nowIso}`).order("due_at", { ascending: true, nullsFirst: false }).limit(KANBAN_LIMIT),
      laneQ().eq("status", "open").lt("due_at", nowIso).order("due_at", { ascending: true }).limit(KANBAN_LIMIT),
      laneQ().eq("status", "done").order("completed_at", { ascending: false }).limit(KANBAN_LIMIT),
      laneQ().eq("status", "cancelled").order("created_at", { ascending: false }).limit(KANBAN_LIMIT),
    ]);
    const listBase = { ...urlParams, gorunum: "" };
    lanes = [
      { key: "overdue", label: "Gecikmiş", tone: "border-danger-500/30 text-danger-500", rows: withDealLabel(overdueLane.data), total: overdueLane.count ?? 0, href: buildHref(PATH, mergeResetPage(listBase, { filter: "overdue" })) },
      { key: "open", label: "Açık", tone: "border-brand-400/30 text-brand-600", rows: withDealLabel(upcomingLane.data), total: upcomingLane.count ?? 0, href: buildHref(PATH, mergeResetPage(listBase, { filter: "" })) },
      { key: "done", label: "Tamamlandı", tone: "border-mint-500/30 text-mint-600", rows: withDealLabel(doneLane.data), total: doneLane.count ?? 0, href: buildHref(PATH, mergeResetPage(listBase, { filter: "done" })) },
      { key: "cancelled", label: "İptal", tone: "border-line text-text-muted", rows: withDealLabel(cancelledLane.data), total: cancelledLane.count ?? 0, href: buildHref(PATH, mergeResetPage(listBase, { filter: "all" })) },
    ];
  } else if (gorunum === "takvim") {
    const startMs = trMonthStartMsFromKey(ay);
    const endMs = trMonthStartMsFromKey(shiftMonthKey(ay, 1) ?? ay);
    const { data: calRows } = await applyBase(
      supabase.from("tasks").select("id, title, status, due_at, priority").eq("tenant_id", ctx.tenantId),
    )
      .in("status", ["open", "done"])
      .gte("due_at", new Date(startMs).toISOString())
      .lt("due_at", new Date(endMs).toISOString())
      .order("due_at", { ascending: true })
      .limit(1000);
    calendarTasks = (calRows ?? []) as CalendarTask[];
    calendarTruncated = calendarTasks.length >= 1000;
  }
  const viewHref = (v: string) => buildHref(PATH, mergeResetPage({ ...urlParams, ay: "" }, { gorunum: v === "liste" ? "" : v }));
  const viewOptions = [
    { value: "liste", label: "Liste", icon: List, href: viewHref("liste") },
    { value: "kanban", label: "Kanban", icon: Columns3, href: viewHref("kanban") },
    { value: "takvim", label: "Takvim", icon: CalendarDays, href: viewHref("takvim") },
  ];
  const totalFiltered = taskTotal ?? tasks.length;
  const win = pageWindow(page, totalFiltered, PAGE_SIZE, tasks.length);

  // "Açık" görünümünde görevler zaman şeritlerine ayrılır:
  // Gecikmiş → Bugün → Yaklaşan (7 gün) → Daha sonra → Tarihsiz.
  // Tek TaskBulkList korunur (toplu seçim şeritler arası çalışır); başlıklar
  // seçilemeyen satır olarak araya girer.
  const GROUPS = [
    { key: "overdue", label: "Gecikmiş", icon: AlarmClock, cls: "border-danger-500/25 bg-danger-500/8 text-danger-500" },
    { key: "today", label: "Bugün", icon: Sunrise, cls: "border-amber-400/40 bg-amber-400/10 text-amber-600" },
    { key: "upcoming", label: "Yaklaşan 7 gün", icon: ICONS.randevu, cls: "border-brand-400/30 bg-brand-600/8 text-brand-600" },
    { key: "later", label: "Daha sonra", icon: CalendarClock, cls: "border-line bg-canvas text-text-muted" },
    { key: "nodate", label: "Tarihsiz", icon: ICONS.gorev, cls: "border-line bg-canvas text-text-muted" },
  ] as const;
  const nowMs = now();
  const todayEndMs = endOfToday().getTime();
  const groupOf = (t: TaskRow): (typeof GROUPS)[number]["key"] => {
    if (!t.due_at) return "nodate";
    const due = new Date(t.due_at).getTime();
    if (due < nowMs) return "overdue";
    if (due <= todayEndMs) return "today";
    if (due <= nowMs + 7 * DAY_MS) return "upcoming";
    return "later";
  };
  const grouped = filter === "open";
  const bulkItems: { id: string; selectable: boolean; card: React.ReactNode }[] = [];
  if (grouped) {
    for (const g of GROUPS) {
      const rows = tasks.filter((t) => groupOf(t) === g.key);
      if (rows.length === 0) continue;
      bulkItems.push({
        id: `serit-${g.key}`,
        selectable: false,
        card: (
          <div className={`mt-2 flex items-center gap-2 rounded-[var(--radius-card)] border px-3.5 py-2 first:mt-0 ${g.cls}`}>
            <g.icon className="h-4 w-4" />
            <span className="text-xs font-extrabold uppercase tracking-[0.08em]">{g.label}</span>
            <span className="numeric ml-auto rounded-full bg-surface px-2 py-0.5 text-xs font-extrabold text-ink-950 shadow-[var(--shadow-xs)]">
              {rows.length}
            </span>
          </div>
        ),
      });
      for (const t of rows) {
        bulkItems.push({
          id: t.id,
          selectable: canEdit && t.status === "open",
          card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} members={members} deals={dealOptions} />,
        });
      }
    }
  } else {
    for (const t of tasks) {
      bulkItems.push({
        id: t.id,
        selectable: canEdit && t.status === "open",
        card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} members={members} deals={dealOptions} />,
      });
    }
  }

  const kpis: KpiItem[] = [
    // İkonografi: görev kavramının ikonu ICONS.gorev (ListChecks).
    { label: "Açık görev", value: counts.open, icon: <ICONS.gorev />, tone: "info", href: hrefWith({ filter: "" }), hint: "tamamlanmamış" },
    { label: "Gecikmiş", value: counts.overdue, icon: <AlarmClock />, tone: "danger", href: hrefWith({ filter: "overdue" }), attention: true, hint: "vadesi geçti" },
    { label: "Bugün", value: counts.today, icon: <Sunrise />, tone: "warning", href: hrefWith({ filter: "today" }), hint: "bugün vadeli" },
    { label: "Yaklaşan 7 gün", value: counts.upcoming, icon: <ICONS.randevu />, tone: "info", href: hrefWith({ filter: "yaklasan" }), hint: "önümüzdeki hafta" },
    { label: "Tamamlanan", value: counts.done, icon: <CheckCircle2 />, tone: "success", href: hrefWith({ filter: "done" }), hint: "bitirilen görev" },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "filter", label: "Zaman", format: (v) => FILTERS.find((f) => f.key === v)?.label ?? v },
    { key: "tur", label: "Tür", format: (v) => KIND_FILTERS.find((k) => k.key === v)?.label ?? v },
    { key: "tekrar", label: "Tekrar", format: () => "Tekrarlayan" },
    { key: "mine", label: "Atanan", format: () => "Sadece benim" },
    { key: "danisman", label: "Danışman", format: (v) => members.find((m) => m.id === v)?.name ?? v },
    { key: "gun", label: "Vade günü", format: (v) => v.split("-").reverse().join(".") },
    { key: "zincir", label: "Tekrar zinciri", format: () => "Seçili zincir" },
    { key: "anlasma", label: "Anlaşma", format: () => tasks.find((t) => t.deal_id === anlasma)?.deal_label ?? "Seçili anlaşma" },
  ]);

  const emptyAll = counts.all === 0;

  return (
    <ListPage>
      <ListHero
        eyebrow="İş takibi"
        art="gorev"
        title="Görevler"
        description="Arama, ziyaret, evrak ve takip görevlerini planlayın; ekibe atayın, gecikmeleri anında görün."
        meta={<ScopeBadge text={listScope.badge} />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitcher options={viewOptions} active={gorunum} label="Görev görünümü" />
            {emptyAll ? null : (
              <ExportCsvButton
                action={exportTasksCsv.bind(null, { filter, tur, mine: mine ? "1" : "", danisman: danismanF, q, tekrar: tekrar ? "1" : "", gun, zincir, anlasma })}
                label="CSV"
                hint="Ekrandaki filtreyle en fazla 2000 görev"
              />
            )}
            {canCreate ? <ButtonLink href="/app/gorevler/yeni" icon={Plus}>Yeni görev</ButtonLink> : null}
          </div>
        }
      />
      {canCreate ? <QuickTask /> : null}

      {emptyAll ? null : <KpiStrip items={kpis} />}

      {/* Açık görevlerin zamanı + türü (kapsamlı gerçek sayımlar; sütun/dilim = filtreli liste) */}
      {emptyAll || gorunum !== "liste" ? null : (
        <ListCharts>
          <ColumnChartCard
            title="Açık görevlerin zamanı"
            subtitle="Gecikmiş, bugün ve önümüzdeki 7 gün"
            icon={CalendarClock}
            tone="warn"
            href={`${PATH}?filter=open`}
            bars={[
              { label: "Gecikmiş", value: counts.overdue, href: `${PATH}?filter=overdue` },
              { label: "Bugün", value: counts.today, href: `${PATH}?filter=today` },
              { label: "7 gün", value: counts.upcoming, href: `${PATH}?filter=yaklasan` },
            ]}
            highlight={0}
          />
          <DistributionCard
            title="Görev türü"
            subtitle="Açık görevlerin türe göre dağılımı"
            icon={PieChart}
            href={`${PATH}?filter=open`}
            centerLabel="açık görev"
            slices={KIND_FILTERS.map((k) => ({ label: k.label, value: kindCounts[k.key] ?? 0, href: `${PATH}?tur=${k.key}` }))}
          />
        </ListCharts>
      )}

      {emptyAll ? null : (
        <>
          <ListToolbar
            pathname={PATH}
            params={urlParams}
            searchPlaceholder="Görev başlığı veya notu ara…"
            searchLabel="Görev ara"
            panelParamKeys={["tekrar", "mine", "danisman"]}
            panel={
              <FilterGrid>
                <FilterSelect
                  name="mine"
                  label="Atanan"
                  value={mine ? "1" : ""}
                  options={[
                    { value: "", label: "Tüm görevler" },
                    { value: "1", label: "Sadece benim" },
                  ]}
                />
                {isManager && members.length > 0 ? (
                  <FilterSelect
                    name="danisman"
                    label="Danışman"
                    value={danismanF}
                    options={[{ value: "", label: "Tüm danışmanlar" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
                  />
                ) : null}
                <FilterSelect
                  name="tekrar"
                  label="Tekrar"
                  value={tekrar ? "1" : ""}
                  options={[
                    { value: "", label: "Tümü" },
                    { value: "1", label: "Tekrarlayan" },
                  ]}
                />
              </FilterGrid>
            }
            chips={chips}
            resultCount={chips.length > 0 ? totalFiltered : undefined}
            resultNoun="görev"
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />

          <div className="space-y-2">
            <CategoryChips
              options={FILTERS.filter((f) => f.key !== "open").map((f) => ({ value: f.key, label: f.label }))}
              counts={{ overdue: counts.overdue, today: counts.today, yaklasan: counts.upcoming, done: counts.done, all: counts.all }}
              total={counts.open}
              allLabel="Açık"
              active={filter === "open" ? "" : filter}
              pathname={PATH}
              params={urlParams}
              paramName="filter"
              label="Görev zamanı"
            />
            <CategoryChips
              options={KIND_FILTERS.map((k) => ({ value: k.key, label: k.label }))}
              counts={kindCounts}
              total={null}
              allLabel="Tüm türler"
              active={tur}
              pathname={PATH}
              params={urlParams}
              paramName="tur"
              label="Görev türü"
            />
          </div>
        </>
      )}

      {gorunum === "kanban" && !emptyAll ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {lanes.map((lane) => (
            <section key={lane.key} aria-label={`${lane.label} görevler`} className="flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-canvas/50 p-2.5">
              <Link href={lane.href} className={`mb-2 flex items-center justify-between rounded-[var(--radius-card)] border bg-surface px-3 py-2 text-xs font-extrabold uppercase tracking-[0.08em] transition hover:border-brand-300 ${lane.tone}`}>
                {lane.label}
                <span className="numeric rounded-full bg-canvas px-2 py-0.5 text-ink-950">{lane.total}</span>
              </Link>
              <div className="space-y-2">
                {lane.rows.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-text-muted">Bu sütunda görev yok.</p>
                ) : (
                  lane.rows.map((t) => (
                    <TaskCard key={t.id} task={t} canEdit={canEdit} canDelete={canDelete} members={members} deals={dealOptions} compact />
                  ))
                )}
                {lane.total > lane.rows.length ? (
                  <Link href={lane.href} className="block px-2 py-1 text-center text-xs font-semibold text-brand-600 hover:underline">
                    Tümünü listede gör ({lane.total})
                  </Link>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      ) : gorunum === "takvim" && !emptyAll ? (
        <TaskCalendar
          monthKey={ay}
          tasks={calendarTasks}
          todayKey={trDayKey(now())}
          truncated={calendarTruncated}
          prevHref={buildHref(PATH, mergeResetPage(urlParams, { ay: shiftMonthKey(ay, -1) ?? ay }))}
          nextHref={buildHref(PATH, mergeResetPage(urlParams, { ay: shiftMonthKey(ay, 1) ?? ay }))}
          dayHref={(dayKey) => buildHref(PATH, mergeResetPage({ ...urlParams, gorunum: "", ay: "" }, { gun: dayKey, filter: "all" }))}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ICONS.gorev}
          illustration={emptyAll ? "start" : "search"}
          title={emptyAll ? "Henüz görev yok" : "Bu filtrede görev yok"}
          description={
            emptyAll
              ? "Yeni görev ekleyerek takip akışınızı başlatın; arama, ziyaret ve evrak işleri tek listede toplanır."
              : "Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
          }
          tone="brand"
          action={
            emptyAll
              ? canCreate
                ? { href: "/app/gorevler/yeni", label: "Yeni görev" }
                : { href: "/app/musteriler", label: "Müşterilere git" }
              : { href: PATH, label: "Filtreleri temizle" }
          }
          secondary={emptyAll ? undefined : { href: `${PATH}?filter=all`, label: "Tüm görevleri göster" }}
        />
      ) : (
        <div className="space-y-2">
          {/* Toplu tamamlama: checkbox seçimi + tek .in() UPDATE (completeTasksBulk).
              Açık görünümde kartlar zaman şeritleriyle gruplanır (şeritler sayfa
              dilimi içinde çalışır — sayfalama gruplamayı/toplu işlemi bozmaz). */}
          <TaskBulkList items={bulkItems} />
        </div>
      )}

      {gorunum === "liste" ? <ListPager pathname={PATH} params={urlParams} window={win} total={totalFiltered} /> : null}
    </ListPage>
  );
}
