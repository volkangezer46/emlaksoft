import { MANAGEMENT_TIER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarClock, CheckCircle2, Plus, Sunrise } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, daysFromNowIso, now, trDayStartMs } from "@/lib/clock";
import { QuickTask } from "./quick-task";
import { TaskCard, type TaskRow } from "./task-card";
import { TaskBulkList } from "./task-bulk-list";
import { EmptyState } from "@/components/app/empty-state";
import { ICONS } from "@/lib/icons";
import { PageHeader } from "@/components/ui/page-header";
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
  searchParams?: Promise<{ q?: string; filter?: string; mine?: string; tur?: string; tekrar?: string; sayfa?: string; yeni?: string; danisman?: string }>;
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

  let query = supabase
    .from("tasks")
    // count: filtreye göre sayfalama ("X–Y / Toplam Z") gerçek toplamı ister.
    .select(
      "id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, recurrence, created_at, assignee:profiles!tasks_assigned_to_fkey(full_name), customer:customers!tasks_customer_id_fkey(full_name)",
      { count: "exact" },
    )
    .eq("tenant_id", ctx.tenantId);
  query = scoped(query);

  if (mine) query = query.eq("assigned_to", ctx.userId);
  if (danismanF) query = query.eq("assigned_to", danismanF);
  if (tur) query = query.eq("kind", tur);
  if (tekrar) query = query.not("recurrence", "is", null);
  if (q) query = query.or(orIlike(["title", "notes"], q));

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

  const tasks = (tasksData ?? []) as unknown as TaskRow[];
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
          card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} members={members} />,
        });
      }
    }
  } else {
    for (const t of tasks) {
      bulkItems.push({
        id: t.id,
        selectable: canEdit && t.status === "open",
        card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} members={members} />,
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
  ]);

  const emptyAll = counts.all === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Görevler"
        description="Arama, ziyaret, evrak ve takip görevlerini planlayın; ekibe atayın, gecikmeleri anında görün."
        meta={<ScopeBadge text={listScope.badge} />}
        actions={canCreate ? <ButtonLink href="/app/gorevler/yeni" icon={Plus}>Yeni görev</ButtonLink> : null}
      />
      {canCreate ? <QuickTask /> : null}

      {emptyAll ? null : <KpiStrip items={kpis} />}

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

      {tasks.length === 0 ? (
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

      <ListPager pathname={PATH} params={urlParams} window={win} total={totalFiltered} />
    </div>
  );
}
