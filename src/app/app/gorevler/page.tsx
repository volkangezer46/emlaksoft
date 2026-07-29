import Link from "next/link";
import { AlarmClock, ArrowUpRight, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Repeat, Sunrise } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, daysFromNowIso, now } from "@/lib/clock";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskCard, type TaskRow } from "./task-card";
import { TaskBulkList } from "./task-bulk-list";
import { EmptyState } from "@/components/app/empty-state";
import { ICONS } from "@/lib/icons";

export const dynamic = "force-dynamic";

/** Sayfa başına görev — gerçek sayfalama (blind .limit yerine). */
const PAGE_SIZE = 50;

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

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
  const d = new Date(now());
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date(now());
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; mine?: string; tur?: string; tekrar?: string; sayfa?: string }>;
}) {
  const ctx = await requireModulePage("tasks");
  const canEdit = (ctx.perms.tasks ?? []).includes("edit");
  const canDelete = (ctx.perms.tasks ?? []).includes("delete");
  const canCreate = (ctx.perms.tasks ?? []).includes("create");
  const params = (await searchParams) ?? {};
  const filter = FILTERS.some((f) => f.key === params.filter) ? params.filter! : "open";
  const mine = params.mine === "1";
  const tur = KIND_FILTERS.some((k) => k.key === params.tur) ? params.tur! : "";
  const tekrar = params.tekrar === "1";
  const page = Math.max(1, Number.parseInt(params.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Filtre linkleri diğer parametreleri korur (filter ⇄ mine ⇄ tur ⇄ tekrar bağımsız).
  // sayfa taşınmaz — çip değişince liste 1. sayfaya döner (filtre kontratı).
  const taskHref = (patch: { filter?: string; mine?: boolean; tur?: string; tekrar?: boolean }) => {
    const f = patch.filter !== undefined ? patch.filter : filter;
    const m = patch.mine !== undefined ? patch.mine : mine;
    const t = patch.tur !== undefined ? patch.tur : tur;
    const r = patch.tekrar !== undefined ? patch.tekrar : tekrar;
    const q = new URLSearchParams();
    q.set("filter", f);
    if (m) q.set("mine", "1");
    if (t) q.set("tur", t);
    if (r) q.set("tekrar", "1");
    return `/app/gorevler?${q.toString()}`;
  };

  // Sayfalama linki — mevcut filtreleri korur, yalnız ?sayfa değişir.
  const pageHref = (n: number) => {
    const q = new URLSearchParams();
    q.set("filter", filter);
    if (mine) q.set("mine", "1");
    if (tur) q.set("tur", tur);
    if (tekrar) q.set("tekrar", "1");
    if (n > 1) q.set("sayfa", String(n));
    return `/app/gorevler?${q.toString()}`;
  };

  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    // count: filtreye göre 100/200 sınırı var; hangi filtrede olursa olsun
    // kullanıcı kaç görevin listede olmadığını görebilmeli.
    .select(
      "id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, recurrence, created_at, assignee:profiles!tasks_assigned_to_fkey(full_name), customer:customers(full_name)",
      { count: "exact" },
    )
    .eq("tenant_id", ctx.tenantId);

  if (mine) query = query.eq("assigned_to", ctx.userId);
  if (tur) query = query.eq("kind", tur);
  if (tekrar) query = query.not("recurrence", "is", null);

  // Eskiden her dal sabit .limit(100/200) ile kırpıyordu; 200'ü aşan ofiste
  // "Daha sonra"/"Tarihsiz" görevler sessizce düşüyordu. Artık gerçek sayfalama:
  // dal yalnız sıralamayı belirler, .range() aşağıda tek yerde uygulanır.
  if (filter === "done") {
    query = query.eq("status", "done").order("completed_at", { ascending: false });
  } else if (filter === "overdue") {
    query = query.eq("status", "open").lt("due_at", new Date(now()).toISOString()).order("due_at", { ascending: true });
  } else if (filter === "yaklasan") {
    // Önümüzdeki 7 gün: bugünden itibaren vadeli açık görevler
    query = query
      .eq("status", "open")
      .gte("due_at", new Date(now()).toISOString())
      .lte("due_at", daysFromNowIso(7))
      .order("due_at", { ascending: true });
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

  const [{ data: tasksData, count: taskTotal }, { data: members }, { data: customers }, counts] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    (async () => {
      const nowIso = new Date(now()).toISOString();
      const head = () => supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId);
      const [{ count: open }, { count: overdue }, { count: today }, { count: upcoming }, { count: done }] = await Promise.all([
        head().eq("status", "open"),
        head().eq("status", "open").lt("due_at", nowIso),
        head().eq("status", "open").gte("due_at", startOfToday().toISOString()).lte("due_at", endOfToday().toISOString()),
        head().eq("status", "open").gte("due_at", nowIso).lte("due_at", daysFromNowIso(7)),
        head().eq("status", "done"),
      ]);
      return { open: open ?? 0, overdue: overdue ?? 0, today: today ?? 0, upcoming: upcoming ?? 0, done: done ?? 0 };
    })(),
  ]);

  const tasks = (tasksData ?? []) as unknown as TaskRow[];

  // Sayfalama toplamları — count filtreye (mine/tür/tekrar) duyarlı gerçek toplam.
  const totalFiltered = taskTotal ?? tasks.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + tasks.length, totalFiltered);

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
          <div className={`mt-2 flex items-center gap-2 rounded-[12px] border px-3.5 py-2 first:mt-0 ${g.cls}`}>
            <g.icon className="h-4 w-4" />
            <span className="text-xs font-extrabold uppercase tracking-[0.08em]">{g.label}</span>
            <span className="numeric ml-auto rounded-full bg-surface px-2 py-0.5 text-[11px] font-extrabold text-ink-950 shadow-[var(--shadow-xs)]">
              {rows.length}
            </span>
          </div>
        ),
      });
      for (const t of rows) {
        bulkItems.push({
          id: t.id,
          selectable: canEdit && t.status === "open",
          card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} />,
        });
      }
    }
  } else {
    for (const t of tasks) {
      bulkItems.push({
        id: t.id,
        selectable: canEdit && t.status === "open",
        card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} />,
      });
    }
  }

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <ICONS.gorev className="h-4 w-4" /> Görev & takip otomasyonu
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Hiçbir takip unutulmasın</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Arama, ziyaret, evrak ve follow-up görevlerini planlayın; ekibe atayın, gecikmeleri anında görün.
            </p>
          </div>
          {canCreate ? <NewTaskDialog members={members ?? []} customers={customers ?? []} /> : null}
        </div>
        <div className="stagger-grid relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Sayaçlar mevcut ?filter= parametresiyle ilgili listeye iner. */}
          {[
            // İkonografi: "Açık görev" CalendarClock (randevu/saat ikonu) ile
            // çiziliyordu; görev kavramının ikonu ICONS.gorev (ListChecks).
            { label: "Açık görev", value: counts.open, icon: ICONS.gorev, tone: "text-cyan-300", href: taskHref({ filter: "open" }) },
            { label: "Gecikmiş", value: counts.overdue, icon: AlarmClock, tone: "text-danger-300", href: taskHref({ filter: "overdue" }) },
            { label: "Bugün", value: counts.today, icon: Sunrise, tone: "text-amber-300", href: taskHref({ filter: "today" }) },
            { label: "Yaklaşan 7 gün", value: counts.upcoming, icon: ICONS.randevu, tone: "text-brand-300", href: taskHref({ filter: "yaklasan" }) },
            { label: "Tamamlanan", value: counts.done, icon: CheckCircle2, tone: "text-mint-300", href: taskHref({ filter: "done" }) },
          ].map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/[0.05] px-4 py-3 transition hover:border-brand-300"
            >
              <p className={`flex items-center gap-1.5 font-display text-2xl font-extrabold ${s.tone}`}>
                <s.icon className="h-4 w-4" /> {s.value}
                <ArrowUpRight className="hover-action ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/50">{s.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Link
              key={f.key}
              href={taskHref({ filter: f.key })}
              className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                active ? "border-brand-400/50 bg-brand-600/10 text-brand-600" : "border-line bg-surface text-ink-950 hover:border-brand-300"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        {/* Tür çipleri: aktifken tekrar tıklamak filtreyi kaldırır */}
        {KIND_FILTERS.map((k) => {
          const active = k.key === tur;
          return (
            <Link
              key={k.key}
              href={taskHref({ tur: active ? "" : k.key })}
              className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                active ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-600" : "border-line bg-surface text-text-muted hover:border-cyan-400/50 hover:text-cyan-600"
              }`}
            >
              {k.label}
            </Link>
          );
        })}
        {/* Tekrarlayan çipi: ?tekrar=1 → sunucu filtresi recurrence not null */}
        <Link
          href={taskHref({ tekrar: !tekrar })}
          className={`flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
            tekrar ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-600" : "border-line bg-surface text-text-muted hover:border-cyan-400/50 hover:text-cyan-600"
          }`}
        >
          <Repeat className="h-3.5 w-3.5" /> Tekrarlayan
        </Link>
        <Link
          href={taskHref({ mine: !mine })}
          className={`ml-auto rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
            mine ? "border-mint-400/50 bg-mint-500/10 text-mint-600" : "border-line bg-surface text-text-muted hover:border-brand-300"
          }`}
        >
          {mine ? "Sadece benim ✓" : "Sadece benim"}
        </Link>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ICONS.gorev}
          illustration={filter === "all" ? "start" : "search"}
          title={filter === "all" ? "Henüz görev yok" : "Bu filtrede görev yok"}
          description={
            filter === "all"
              ? "Yeni görev ekleyerek takip akışınızı başlatın; arama, ziyaret ve evrak işleri tek listede toplanır."
              : "Seçili filtreye uyan görev yok. Filtreyi genişletip tekrar deneyin."
          }
          tone="brand"
          secondary={filter === "all" ? undefined : { href: "/app/gorevler?filter=all", label: "Tüm görevleri göster" }}
        />
      ) : (
        <div className="space-y-2">
          {/* Toplu tamamlama: checkbox seçimi + tek .in() UPDATE (completeTasksBulk).
              Açık görünümde kartlar zaman şeritleriyle gruplanır (şeritler sayfa
              dilimi içinde çalışır — sayfalama gruplamayı/toplu işlemi bozmaz). */}
          <TaskBulkList items={bulkItems} />
        </div>
      )}

      {/* Sayfalama — filtre parametreleri linklerde korunur */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={PAGER_BTN}>
                <ChevronLeft className="h-4 w-4" /> Önceki
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                <ChevronLeft className="h-4 w-4" /> Önceki
              </span>
            )}
            <span className="numeric px-1 text-text-faint">
              {Math.min(page, totalPages)} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className={PAGER_BTN}>
                Sonraki <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                Sonraki <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
