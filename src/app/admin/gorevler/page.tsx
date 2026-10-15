import Link from "@/components/ui/smart-link";
import { AlertTriangle, Building2, CalendarClock, CheckCheck, ClipboardList, Flame, HeartPulse, Inbox, LifeBuoy, ListTodo, UserRoundCheck, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminChip } from "@/components/admin/admin-list";
import { PageTabs } from "@/components/app/page-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { Pagination, PAGE_SIZE, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { requirePlatformModule } from "@/lib/platform";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import { getSetting } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { HEALTH_BAND_LABELS, HEALTH_BAND_TONE, HEALTH_DEFAULT_RISK_THRESHOLD, healthBand } from "@/lib/admin/health-score";
import { loadCrmCatalog } from "@/lib/admin/platform-crm";
import { PLAYBOOK_RULES, PLAYBOOK_RULE_LABELS, isPlaybookRule, type PlaybookRule } from "@/lib/admin/cs-playbook-labels";
import { TASK_TABS, dueState, loadOwnedAccounts, loadQueueCounts, loadTaskQueue, parseTaskTab, type OwnedAccount, type QueueTask, type TaskTab } from "@/lib/admin/task-queue";
import { cn } from "@/lib/utils";
import { TaskRowActions } from "./task-row-actions";

export const metadata = { title: "Görevler" };

const BASE = "/admin/gorevler";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB_ICONS: Record<TaskTab, typeof ListTodo> = {
  benim: UserRoundCheck,
  atanmamis: Inbox,
  geciken: AlertTriangle,
  ekip: Users,
  tamamlanan: CheckCheck,
  portfoy: Building2,
};

const STATUS_LABEL: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Ödeme gecikmiş", suspended: "Askıda" };
const ROLE_HINT: Record<string, string> = { super_admin: "Süper admin", ops: "Operasyon", support: "Destek", billing: "Muhasebe" };

function hrefFor(tab: TaskTab, opts: { kaynak?: PlaybookRule | null; sayfa?: number } = {}): string {
  const q = new URLSearchParams();
  if (tab !== "benim") q.set("sekme", tab);
  if (opts.kaynak) q.set("kaynak", opts.kaynak);
  if (opts.sayfa && opts.sayfa > 1) q.set("sayfa", String(opts.sayfa));
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * Ofisler > Görevler (PA-2): platform personelinin iş kuyruğu. Sekmeler: Bana atanan · Atanmamış · Geciken · Tüm açık ·
 * Tamamlanan · Ofislerim (sorumlu olduğum ofisler: sağlık, 7 günlük değişim, dönem sonu, açık talep/görev).
 * Oyun kitabı (PA-1) görevleri kaynak kural rozetiyle gelir; `kaynak=` süzgeci. `gorev=<id>` bildirimden gelen görevi
 * listenin üstünde vurgular. Satır eylemleri: tamamla, ertele (1/3/7 gün), üstlen, yeniden ata.
 */
export default async function TaskQueuePage({ searchParams }: { searchParams: Promise<{ sekme?: string; kaynak?: string; sayfa?: string; gorev?: string }> }) {
  const staff = await requirePlatformModule("tenants");
  const sp = await searchParams;
  const tab = parseTaskTab(sp.sekme);
  const rule = isPlaybookRule(sp.kaynak) ? sp.kaynak : null;
  const page = parsePage(sp.sayfa);
  const focusId = typeof sp.gorev === "string" && UUID_RE.test(sp.gorev) ? sp.gorev : null;
  const canEdit = officeAdminCan(staff, "note");
  const admin = createAdminClient();
  const nowMs = now();

  const [counts, catalog, threshold, queue, owned] = await Promise.all([
    loadQueueCounts(admin, staff.id, nowMs),
    loadCrmCatalog(admin),
    getSetting<number>(CRM_SETTING_KEYS.riskThreshold).catch(() => HEALTH_DEFAULT_RISK_THRESHOLD),
    tab === "portfoy" ? Promise.resolve(null) : loadTaskQueue(admin, { tab, staffId: staff.id, rule, range: pageRange(page), nowMs, focusId }),
    tab === "portfoy" ? loadOwnedAccounts(admin, staff.id, nowMs) : Promise.resolve(null),
  ]);
  const staffName = new Map(catalog.staff.map((s) => [s.id, s.name]));
  const people = catalog.staff.map((s) => ({ id: s.id, name: s.id === staff.id ? `${s.name} (ben)` : s.name, hint: ROLE_HINT[s.role] ?? s.role }));

  const tabs = TASK_TABS.map((t) => {
    const n = !counts ? null : t.id === "benim" ? counts.mine : t.id === "atanmamis" ? counts.unassigned : t.id === "geciken" ? counts.overdue : t.id === "ekip" ? counts.open : null;
    return { id: t.id, label: n ? `${t.label} (${n})` : t.label, icon: TAB_ICONS[t.id] };
  });

  return (
    <div className="space-y-5">
      <AdminPageHeader
        art="support"
        eyebrow="Ofisler"
        icon={ClipboardList}
        title="Görevler"
        description="Size atanan takip görevleri, sahipsiz kalanlar ve sorumlu olduğunuz ofisler tek ekranda. Otomatik görevler müşteri başarısı kurallarından gelir."
      >
        {counts ? (
          <KpiGrid label="Görev göstergeleri">
            <KpiCard layout="inline" label="Bana atanan" value={counts.mine} href={hrefFor("benim")} icon={UserRoundCheck} tone="brand" tinted={tab === "benim"} hint={counts.dueToday ? `${counts.dueToday} görevin vadesi bugün` : "Bugün vadesi gelen yok"} />
            <KpiCard layout="inline" label="Gecikmiş (benim)" value={counts.mineOverdue} href={hrefFor("benim")} icon={Flame} tone={counts.mineOverdue ? "danger" : "neutral"} hint="Vadesi geçmiş açık görevleriniz" />
            <KpiCard layout="inline" label="Atanmamış" value={counts.unassigned} href={hrefFor("atanmamis")} icon={Inbox} tone={counts.unassigned ? "warn" : "neutral"} tinted={tab === "atanmamis"} hint="Sorumlusu olmayan ofislerden" />
            <KpiCard layout="inline" label="Ekipte geciken" value={counts.overdue} href={hrefFor("geciken")} icon={AlertTriangle} tone={counts.overdue ? "danger" : "neutral"} tinted={tab === "geciken"} hint="Tüm personel" />
          </KpiGrid>
        ) : null}
      </AdminPageHeader>

      <PageTabs base={BASE} label="Görev sekmeleri" tabs={tabs} active={tab} />

      {tab === "portfoy" ? (
        <OwnedAccounts rows={owned?.rows ?? []} ready={owned?.ready ?? false} threshold={threshold} />
      ) : !queue || !queue.ready ? (
        <SetupPending />
      ) : (
        <section className="space-y-3" aria-label="Görev listesi">
          {queue.rulesReady ? (
            <nav aria-label="Kaynak süzgeci" className="flex flex-wrap gap-2">
              <AdminChip href={hrefFor(tab)} on={!rule}>
                Tümü
              </AdminChip>
              {PLAYBOOK_RULES.map((r) => (
                <AdminChip key={r} href={hrefFor(tab, { kaynak: rule === r ? null : r })} on={rule === r}>
                  {PLAYBOOK_RULE_LABELS[r]}
                </AdminChip>
              ))}
            </nav>
          ) : null}

          {queue.focus ? (
            <div className="rounded-[var(--radius-panel)] border-2 border-brand-500/40 bg-brand-600/5 p-1" aria-label="Bildirimden açılan görev">
              <TaskItem t={queue.focus} focus nowMs={nowMs} threshold={threshold} staffName={staffName} meId={staff.id} people={people} canEdit={canEdit} />
            </div>
          ) : null}

          {queue.rows.length === 0 && !queue.focus ? (
            <EmptyState
              icon={tab === "tamamlanan" ? CheckCheck : ListTodo}
              title={emptyTitle(tab, rule)}
              description={emptyText(tab)}
              action={tab === "benim" && counts?.unassigned ? { label: `Atanmamış ${counts.unassigned} görevi gör`, href: hrefFor("atanmamis") } : undefined}
            />
          ) : (
            <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
              {queue.rows.map((t) => (
                <TaskItem key={t.id} t={t} nowMs={nowMs} threshold={threshold} staffName={staffName} meId={staff.id} people={people} canEdit={canEdit} />
              ))}
            </ul>
          )}
          <Pagination page={page} total={queue.total} pageSize={PAGE_SIZE} hrefFor={(p) => hrefFor(tab, { kaynak: rule, sayfa: p })} />
        </section>
      )}
    </div>
  );
}

function emptyTitle(tab: TaskTab, rule: PlaybookRule | null): string {
  if (rule) return `“${PLAYBOOK_RULE_LABELS[rule]}” kaynaklı görev yok`;
  if (tab === "benim") return "Size atanmış açık görev yok";
  if (tab === "atanmamis") return "Sahipsiz görev yok";
  if (tab === "geciken") return "Geciken görev yok";
  if (tab === "tamamlanan") return "Henüz tamamlanan görev yok";
  return "Açık görev yok";
}

function emptyText(tab: TaskTab): string {
  if (tab === "benim") return "Sağlık düşüşü, kötü NPS, düşük destek puanı, iptal talebi ya da hareketsiz deneme olduğunda sorumlusu olduğunuz ofis için görev burada açılır.";
  if (tab === "atanmamis") return "Sorumlu personeli olmayan ofislerin otomatik görevleri burada toplanır. Ofislere sorumlu atamak için Ofisler listesinde toplu işlemi kullanın.";
  return "Ofis 360 > İlişki sekmesinden elle görev de ekleyebilirsiniz.";
}

function SetupPending() {
  return (
    <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">
      Ofis CRM kurulumu bekliyor: görev tablosu veritabanı güncellemesiyle (20261013004400) gelir.
    </p>
  );
}

function HealthChip({ score, threshold, href }: { score: number | null; threshold: number; href?: string }) {
  if (score == null) return null;
  const band = healthBand(score, threshold);
  const cls = `adm-badge pm-t-${HEALTH_BAND_TONE[band]} tabular-nums`;
  const body = (
    <>
      <HeartPulse aria-hidden="true" /> {score} · {HEALTH_BAND_LABELS[band]}
    </>
  );
  return href ? (
    <Link href={href} className={`${cls} focus-ring`} title="Sağlık skoru ayrıntısı">
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

function TaskItem({
  t,
  focus,
  nowMs,
  threshold,
  staffName,
  meId,
  people,
  canEdit,
}: {
  t: QueueTask;
  focus?: boolean;
  nowMs: number;
  threshold: number;
  staffName: ReadonlyMap<string, string>;
  meId: string;
  people: { id: string; name: string; hint: string }[];
  canEdit: boolean;
}) {
  const due = t.status === "open" ? dueState(t.dueAt, nowMs) : "none";
  const Wrapper = focus ? "div" : "li";
  return (
    <Wrapper className={cn("flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4", focus && "rounded-[var(--radius-card)] bg-surface")}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {t.priority === "yuksek" && t.status === "open" ? <span className="adm-badge pm-t-danger">Öncelikli</span> : null}
          {t.rule ? (
            <Link href={hrefFor("ekip", { kaynak: t.rule })} className="adm-badge pm-t-brand focus-ring" title="Bu kuraldan gelen tüm açık görevler">
              {PLAYBOOK_RULE_LABELS[t.rule]}
            </Link>
          ) : (
            <span className="adm-badge pm-t-neutral">Elle</span>
          )}
          {due === "overdue" ? <span className="adm-badge pm-t-danger">Gecikti</span> : due === "today" ? <span className="adm-badge pm-t-warn">Bugün</span> : null}
        </div>
        <p className={cn("text-sm font-semibold text-ink-950 [overflow-wrap:anywhere]", t.status === "done" && "text-text-muted line-through")}>{t.title}</p>
        {t.body ? <p className="line-clamp-3 text-sm text-text-muted [overflow-wrap:anywhere]">{t.body}</p> : null}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {t.tenantId ? (
            <Link href={`/admin/tenants/${t.tenantId}?sekme=iliski`} className="focus-ring inline-flex min-h-6 items-center gap-1 font-semibold text-brand-600 hover:underline touch:min-h-11">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> {t.tenantName ?? "Ofis"}
            </Link>
          ) : null}
          <HealthChip score={t.score} threshold={threshold} href={t.tenantId ? `/admin/tenants/${t.tenantId}?sekme=iliski` : undefined} />
          {t.status === "done" ? (
            <span>Tamamlandı{t.doneAt ? `: ${formatDateTimeTr(t.doneAt)}` : ""}</span>
          ) : t.dueAt ? (
            <span className={cn("inline-flex items-center gap-1", due === "overdue" && "font-semibold text-[var(--pm-danger-text)]")}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDateTimeTr(t.dueAt)}
            </span>
          ) : (
            <span>Vade yok</span>
          )}
          <span>{t.assigneeId ? (t.assigneeId === meId ? "Siz" : (staffName.get(t.assigneeId) ?? "Pasif personel")) : "Atanmamış"}</span>
        </p>
      </div>
      <div className="shrink-0">
        <TaskRowActions taskId={t.id} title={t.title} done={t.status === "done"} assigneeId={t.assigneeId} meId={meId} people={people} canEdit={canEdit} />
      </div>
    </Wrapper>
  );
}

function OwnedAccounts({ rows, ready, threshold }: { rows: OwnedAccount[]; ready: boolean; threshold: number }) {
  if (!ready) return <SetupPending />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Sorumlu olduğunuz ofis yok"
        description="Ofisler listesinde süzüp toplu işlemle kendinizi sorumlu personel olarak atayabilirsiniz; atanan ofislerin sağlık ve yenileme durumu burada izlenir."
        action={{ label: "Sorumlusu olmayan ofisler", href: "/admin/tenants?sorumlu=yok" }}
      />
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label="Sorumlu olduğunuz ofisler">
      {rows.map((a) => (
        <li key={a.tenantId} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/admin/tenants/${a.tenantId}`} className="focus-ring min-w-0 font-display font-bold text-ink-950 hover:underline [overflow-wrap:anywhere]">
              {a.name}
            </Link>
            <span className="adm-badge pm-t-neutral shrink-0">{STATUS_LABEL[a.status] ?? a.status}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <HealthChip score={a.score} threshold={threshold} href={`/admin/tenants/${a.tenantId}?sekme=iliski`} />
            {a.delta7 != null && a.delta7 !== 0 ? (
              <span className={cn("font-semibold tabular-nums", a.delta7 < 0 ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
                7 gün: {a.delta7 > 0 ? `+${a.delta7}` : a.delta7}
              </span>
            ) : null}
            {a.cancelAtPeriodEnd ? <span className="adm-badge pm-t-danger">İptal talebi</span> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-text-faint">{a.status === "trial" ? "Deneme bitişi" : "Dönem sonu"}</dt>
            <dd className="text-right font-semibold text-ink-950">{a.status === "trial" ? (a.trialEndsAt ? formatDateTr(a.trialEndsAt) : "—") : a.periodEnd ? formatDateTr(a.periodEnd) : "—"}</dd>
            <dt className="text-text-faint">Açık destek talebi</dt>
            <dd className="text-right">
              <Link href={`/admin/tickets?tenant=${a.tenantId}`} className="focus-ring inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> {a.openTickets}
              </Link>
            </dd>
            <dt className="text-text-faint">Açık görev</dt>
            <dd className="text-right">
              <Link href={`/admin/tenants/${a.tenantId}?sekme=iliski`} className="focus-ring inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                <ListTodo className="h-3.5 w-3.5" aria-hidden="true" /> {a.openTasks}
              </Link>
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
