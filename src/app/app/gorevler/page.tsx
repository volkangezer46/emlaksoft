import Link from "next/link";
import { AlarmClock, ArrowUpRight, CalendarClock, CheckCircle2, ListChecks, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskCard, type TaskRow } from "./task-card";
import { TaskBulkList } from "./task-bulk-list";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "Açık" },
  { key: "overdue", label: "Gecikmiş" },
  { key: "today", label: "Bugün" },
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

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; mine?: string; tur?: string; tekrar?: string }>;
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

  // Filtre linkleri diğer parametreleri korur (filter ⇄ mine ⇄ tur ⇄ tekrar bağımsız).
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

  if (filter === "done") {
    query = query.eq("status", "done").order("completed_at", { ascending: false }).limit(100);
  } else if (filter === "overdue") {
    query = query.eq("status", "open").lt("due_at", new Date().toISOString()).order("due_at", { ascending: true });
  } else if (filter === "today") {
    query = query
      .eq("status", "open")
      .gte("due_at", startOfToday().toISOString())
      .lte("due_at", endOfToday().toISOString())
      .order("due_at", { ascending: true });
  } else if (filter === "all") {
    query = query.order("created_at", { ascending: false }).limit(200);
  } else {
    query = query.eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).limit(200);
  }

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
      const now = new Date().toISOString();
      const [{ count: open }, { count: overdue }, { count: done }] = await Promise.all([
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "open"),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", ctx.tenantId)
          .eq("status", "open")
          .lt("due_at", now),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "done"),
      ]);
      return { open: open ?? 0, overdue: overdue ?? 0, done: done ?? 0 };
    })(),
  ]);

  const tasks = (tasksData ?? []) as unknown as TaskRow[];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <ListChecks className="h-4 w-4" /> Görev & takip otomasyonu
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Hiçbir takip unutulmasın</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Arama, ziyaret, evrak ve follow-up görevlerini planlayın; ekibe atayın, gecikmeleri anında görün.
            </p>
          </div>
          {canCreate ? <NewTaskDialog members={members ?? []} customers={customers ?? []} /> : null}
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-3">
          {/* Sayaçlar mevcut ?filter= parametresiyle ilgili listeye iner. */}
          {[
            { label: "Açık görev", value: counts.open, icon: CalendarClock, tone: "text-cyan-300", href: taskHref({ filter: "open" }) },
            { label: "Gecikmiş", value: counts.overdue, icon: AlarmClock, tone: "text-danger-300", href: taskHref({ filter: "overdue" }) },
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
          icon={ListChecks}
          title="Bu filtrede görev yok"
          description="Yeni görev ekleyerek takip akışınızı başlatın."
          tone="brand"
        />
      ) : (
        <div className="space-y-2">
          <ListLimitNotice shown={tasks.length} total={taskTotal} hint="Filtre uygulayarak daraltın." />
          {/* Toplu tamamlama: checkbox seçimi + tek .in() UPDATE (completeTasksBulk) */}
          <TaskBulkList
            items={tasks.map((t) => ({
              id: t.id,
              selectable: canEdit && t.status === "open",
              card: <TaskCard task={t} canEdit={canEdit} canDelete={canDelete} />,
            }))}
          />
        </div>
      )}
    </div>
  );
}
