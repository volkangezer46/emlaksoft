import { KpiGrid } from "@/components/ui/dashboard-grid";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Clock3,
  Inbox,
  LifeBuoy,
  Search,
  Siren,
  TimerReset,
  X,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PAGE_SIZE, Pagination, pageRange } from "@/app/admin/_components/pagination";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { ExportButton } from "@/components/admin/export-button";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { exportTicketsCsv } from "@/app/actions/platform-export";
import { inFilter, orIlike, safeLike } from "@/lib/pgrst";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/lib/support/ticket-contract";
import { slaStateOf } from "./sla";
import { TicketStatusDonut, TicketResolutionGauge } from "./ticket-dashboard-visuals";
import { TicketQueueView, type TicketQueueRow } from "./ticket-queue-view";
import {
  buildTicketListHref,
  formatDurationHours,
  isUuid,
  normalizeTicketFilters,
  TICKET_CATEGORY_KEYS,
  TICKET_CATEGORY_LABEL,
  TICKET_OPEN_STATUSES,
  TICKET_PRIORITY_KEYS,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_KEYS,
  TICKET_STATUS_LABEL,
  type TicketListFilters,
} from "./ticket-list-model";

const STATUS_COLOR: Record<string, string> = {
  open: "var(--brand-500)",
  in_progress: "var(--cyan-400)",
  waiting: "var(--amber-400)",
  resolved: "var(--mint-500)",
  closed: "rgba(10,34,71,0.25)",
};

const SLA_FILTER_LABEL: Record<string, string> = {
  normal: "SLA normal",
  warning: "SLA riskte",
  breached: "SLA aşıldı",
};

type TenantRelation = { name?: string } | { name?: string }[] | null;

type TicketQueueSourceRow = {
  id: string;
  ticket_no: string | null;
  subject: string;
  body?: string | null;
  category: string;
  priority: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  last_activity_at?: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
  first_response_breached_at?: string | null;
  resolution_due_at: string | null;
  resolution_breached_at?: string | null;
  tenant_id: string | null;
  tenant_name?: string | null;
  tenant?: TenantRelation;
  assigned_staff_id: string | null;
  assigned_staff_name?: string | null;
  message_count?: number | null;
};

type TicketMetricsPayload = {
  total: number;
  open: number;
  urgent: number;
  resolved: number;
  resolutionRate: number;
  avgResolutionSeconds: number | null;
  firstResponseBreached: number;
  resolutionBreached: number;
  statusCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  last14Days: { date: string; value: number }[];
  slaPolicy: string;
};

type TicketQueuePayload = {
  items: TicketQueueSourceRow[];
  total: number;
  limit: number;
  offset: number;
  slaPolicy: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMetricsPayload(value: unknown): TicketMetricsPayload {
  if (!isRecord(value) || !isRecord(value.statusCounts) || !Array.isArray(value.last14Days)) {
    throw new Error("Destek metrik servisi geçersiz bir yanıt döndürdü.");
  }
  return value as TicketMetricsPayload;
}

function readQueuePayload(value: unknown): TicketQueuePayload {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total !== "number") {
    throw new Error("Destek kuyruğu servisi geçersiz bir yanıt döndürdü.");
  }
  return value as TicketQueuePayload;
}

function relationName(value: TenantRelation) {
  if (!value) return "—";
  return Array.isArray(value) ? (value[0]?.name ?? "—") : (value.name ?? "—");
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: "brand" | "amber" | "danger" | "cyan" | "mint";
  href?: string;
}) {
  const toneClass = {
    brand: "bg-brand-600/10 text-brand-700",
    amber: "bg-amber-400/15 text-amber-700",
    danger: "bg-danger-500/10 text-danger-700",
    cyan: "bg-cyan-400/12 text-ink-800",
    mint: "bg-mint-500/12 text-mint-700",
  }[tone];
  const accentClass = {
    brand: "from-brand-500/70",
    amber: "from-amber-400/80",
    danger: "from-danger-500/75",
    cyan: "from-cyan-400/75",
    mint: "from-mint-500/75",
  }[tone];

  const content = (
    <>
      <span className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent", accentClass)} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <span className={cn("grid h-10 w-10 place-items-center rounded-[var(--radius-card)]", toneClass)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        {href ? <span className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Görüntüle</span> : null}
      </div>
      <p className="numeric mt-3 font-display text-2xl font-extrabold leading-none text-ink-950">
        {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
      </p>
      <p className="mt-1 text-xs font-bold text-ink-950">{label}</p>
      <p className="mt-1 truncate text-xs text-text-muted">{hint}</p>
    </>
  );

  const className = "surface-card group relative block min-h-[136px] overflow-hidden rounded-[var(--radius-card)] p-4 transition";
  return href ? (
    <Link href={href} className={cn(className, "focus-ring press lift hover:border-brand-300")}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function StatusCount({ count, active }: { count: number; active: boolean }) {
  return (
    <span className={cn("numeric rounded-full px-1.5 py-0.5 text-xs font-extrabold", active ? "bg-white/18 text-white" : "bg-ink-950/[0.06] text-text-muted")}>
      {count}
    </span>
  );
}

function statusPillClass(active: boolean) {
  return cn(
    "focus-ring press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition",
    active ? "bg-ink-950 text-white shadow-[var(--elev-2)]" : "text-text-muted hover:bg-surface hover:text-ink-950",
  );
}

function queryFailure(errors: unknown[]) {
  const failed = errors.filter(Boolean);
  if (failed.length === 0) return;
  console.error(
    "admin tickets query failed",
    failed.map((error) => {
      if (typeof error !== "object" || error === null) return { code: "unknown" };
      const value = error as { code?: string; message?: string };
      return { code: value.code ?? "unknown", message: value.message ?? "query failed" };
    }),
  );
  throw new Error("Destek kuyruğu verileri yüklenemedi. Lütfen tekrar deneyin.");
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    durum?: string;
    oncelik?: string;
    kategori?: string;
    atanan?: string;
    tenant?: string;
    sla?: string;
    sirala?: string;
    yon?: string;
    sayfa?: string;
  }>;
}) {
  const currentStaff = await requirePlatformModule("tickets");
  const filters = normalizeTicketFilters((await searchParams) ?? {});
  const page = filters.sayfa ?? 1;
  const admin = createAdminClient();

  const hasSearch = Boolean(filters.q && filters.q.length >= 2);
  const usesCanonicalQueue = filters.sirala === "queue";

  // Queue RPC; SLA aşımı, aciliyet, hedef süre ve son hareketi birlikte değerlendirir.
  // Kullanıcı açıkça farklı bir kolon sırası seçerse güvenli doğrudan sorguya düşer.
  const searchPattern = filters.q ? safeLike(filters.q) : "%%";
  const searchedTenantResult = !usesCanonicalQueue && hasSearch
    ? await admin.from("tenants").select("id").ilike("name", searchPattern).limit(100)
    : { data: [] as { id: string }[], error: null };
  queryFailure([searchedTenantResult.error]);
  const searchedTenantIds = (searchedTenantResult.data ?? []).map((tenant) => tenant.id);

  let listQuery = admin
    .from("support_tickets")
    .select(
      "id, ticket_no, subject, body, category, priority, status, created_at, updated_at, last_activity_at, first_response_due_at, first_response_at, first_response_breached_at, resolution_due_at, resolution_breached_at, tenant_id, assigned_staff_id, tenant:tenants(name)",
      { count: "exact" },
    );

  if (filters.durum === "acik") listQuery = listQuery.in("status", [...TICKET_OPEN_STATUSES]);
  else if (filters.durum === "cozulmus") listQuery = listQuery.in("status", ["resolved", "closed"]);
  else if (filters.durum) listQuery = listQuery.eq("status", filters.durum);
  if (filters.oncelik) listQuery = listQuery.eq("priority", filters.oncelik);
  if (filters.kategori) listQuery = listQuery.eq("category", filters.kategori);
  if (filters.tenant) listQuery = listQuery.eq("tenant_id", filters.tenant);
  if (filters.atanan === "atanmadi") listQuery = listQuery.is("assigned_staff_id", null);
  else if (filters.atanan) listQuery = listQuery.eq("assigned_staff_id", filters.atanan);

  if (hasSearch && filters.q) {
    const parts = [orIlike(["ticket_no", "subject", "body"], filters.q)];
    const tenantClause = inFilter("tenant_id", searchedTenantIds);
    if (tenantClause) parts.push(tenantClause);
    if (isUuid(filters.q)) parts.push(`id.eq.${filters.q}`);
    listQuery = listQuery.or(parts.join(","));
  }

  const sortKey = filters.sirala === "queue" ? "created_at" : (filters.sirala ?? "created_at");
  const sortAscending = filters.yon === "asc";
  listQuery = listQuery
    .order(sortKey, { ascending: sortAscending })
    .order("id", { ascending: false })
    .range(...pageRange(page));

  const selectedTenantPromise = filters.tenant
    ? admin.from("tenants").select("id, name").eq("id", filters.tenant).maybeSingle()
    : Promise.resolve({ data: null as { id: string; name: string } | null, error: null });
  let categoryDefinitionsQuery = admin
    .from("definitions")
    .select("value, label, tenant_id, sort_order")
    .eq("category", "ticket_category")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (filters.tenant) {
    categoryDefinitionsQuery = categoryDefinitionsQuery.or(`tenant_id.is.null,tenant_id.eq.${filters.tenant}`);
  }

  const [
    queueResult,
    directListResult,
    metricsResult,
    selectedTenantResult,
    staffResult,
    tenantOptionsResult,
    categoryDefinitionsResult,
  ] = await Promise.all([
    usesCanonicalQueue
      ? admin.rpc("support_ticket_queue_v2", {
          p_status: filters.durum ?? null,
          p_priority: filters.oncelik ?? null,
          p_tenant_id: filters.tenant ?? null,
          p_assigned_staff_id: filters.atanan === "atanmadi" ? null : (filters.atanan ?? null),
          p_search: filters.q ?? null,
          p_limit: PAGE_SIZE,
          p_offset: (page - 1) * PAGE_SIZE,
          p_category: filters.kategori ?? null,
          p_unassigned: filters.atanan === "atanmadi",
          p_sla: filters.sla ?? null,
        })
      : Promise.resolve({ data: null, error: null }),
    usesCanonicalQueue
      ? Promise.resolve({ data: null, count: null, error: null })
      : listQuery,
    admin.rpc("support_ticket_metrics_v2", { p_tenant_id: filters.tenant ?? null }),
    selectedTenantPromise,
    admin
      .from("platform_staff")
      .select("id, full_name")
      .eq("is_active", true)
      .in("role", ["super_admin", "ops", "support"])
      .order("full_name"),
    admin
      .from("tenants")
      .select("id, name, status")
      .in("status", ["trial", "active", "past_due"])
      .order("name")
      .limit(2000),
    categoryDefinitionsQuery,
  ]);

  queryFailure([
    queueResult.error,
    directListResult.error,
    metricsResult.error,
    selectedTenantResult.error,
    staffResult.error,
    tenantOptionsResult.error,
    categoryDefinitionsResult.error,
  ]);

  const queuePayload = usesCanonicalQueue ? readQueuePayload(queueResult.data) : null;
  const metrics = readMetricsPayload(metricsResult.data);
  const fetched = (queuePayload?.items ?? directListResult.data ?? []) as TicketQueueSourceRow[];
  const listTotal = queuePayload?.total ?? directListResult.count ?? 0;
  const pageIds = fetched.map((ticket) => ticket.id);
  const needsBodySupplement = fetched.some((ticket) => typeof ticket.body !== "string");
  const [bodyResult, messageResult] = await Promise.all([
    pageIds.length && needsBodySupplement
      ? admin.from("support_tickets").select("id, body").in("id", pageIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[], error: null }),
    pageIds.length && !usesCanonicalQueue
      ? admin.from("support_ticket_messages").select("ticket_id, author_kind").in("ticket_id", pageIds)
      : Promise.resolve({ data: [] as { ticket_id: string; author_kind: string }[], error: null }),
  ]);
  queryFailure([bodyResult.error, messageResult.error]);

  const bodyById = new Map((bodyResult.data ?? []).map((ticket) => [ticket.id, ticket.body]));
  const messageCount = new Map<string, number>();
  for (const message of messageResult.data ?? []) {
    messageCount.set(message.ticket_id, (messageCount.get(message.ticket_id) ?? 0) + 1);
  }

  const staff = staffResult.data ?? [];
  const staffName = new Map(staff.map((person) => [person.id, person.full_name]));
  const rows: TicketQueueRow[] = fetched.map((ticket) => ({
    id: ticket.id,
    ticketNo: ticket.ticket_no ?? null,
    subject: ticket.subject,
    body: ticket.body ?? bodyById.get(ticket.id) ?? "",
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdAt: ticket.created_at,
    updatedAt: ticket.last_activity_at ?? ticket.updated_at,
    tenantId: ticket.tenant_id,
    tenantName: ticket.tenant_name ?? relationName(ticket.tenant ?? null),
    assignedStaffId: ticket.assigned_staff_id ?? null,
    assignedStaffName: ticket.assigned_staff_name ?? (ticket.assigned_staff_id ? (staffName.get(ticket.assigned_staff_id) ?? "Personel") : null),
    messageCount: ticket.message_count ?? messageCount.get(ticket.id) ?? 0,
    sla: slaStateOf({
      status: ticket.status,
      createdAt: ticket.created_at,
      hasStaffReply: Boolean(ticket.first_response_at),
      priority: ticket.priority,
      firstResponseDueAt: ticket.first_response_due_at,
      firstResponseAt: ticket.first_response_at,
      firstResponseBreachedAt: ticket.first_response_breached_at,
      resolutionDueAt: ticket.resolution_due_at,
      resolutionBreachedAt: ticket.resolution_breached_at,
    }),
  }));

  const statusCounts = new Map(TICKET_STATUS_KEYS.map((status) => [status, metrics.statusCounts[status] ?? 0]));
  const countOf = (status: TicketStatus) => statusCounts.get(status) ?? 0;
  const total = metrics.total;
  const open = metrics.open;
  const urgent = metrics.urgent;
  const resolved = metrics.resolved;
  const solveRate = metrics.resolutionRate;
  const averageHours = metrics.avgResolutionSeconds === null
    ? null
    : Math.round(metrics.avgResolutionSeconds / 3_600);
  const averageLabel = formatDurationHours(averageHours);

  const dailyNew = metrics.last14Days.map((day) => ({
    label: `${day.date.slice(8, 10)}.${day.date.slice(5, 7)}`,
    value: day.value,
  }));
  const newLast14 = dailyNew.reduce((sum, day) => sum + day.value, 0);

  const selectedTenant = selectedTenantResult.data;
  const staticCategoryOptions = TICKET_CATEGORY_KEYS.map((value, index) => ({
    value,
    label: TICKET_CATEGORY_LABEL[value],
    sort: index + 1,
  }));
  const definitionRows = categoryDefinitionsResult.data ?? [];

  const categoryByValue = new Map<string, { value: string; label: string; sort: number; tenantScoped: boolean }>();
  for (const definition of definitionRows) {
    const tenantScoped = definition.tenant_id !== null;
    const existing = categoryByValue.get(definition.value);
    if (
      !existing ||
      (Boolean(filters.tenant) && tenantScoped && !existing.tenantScoped) ||
      (!filters.tenant && !tenantScoped && existing.tenantScoped)
    ) {
      categoryByValue.set(definition.value, {
        value: definition.value,
        label: definition.label,
        sort: definition.sort_order ?? 0,
        tenantScoped,
      });
    }
  }
  for (const value of Object.keys(metrics.categoryCounts ?? {})) {
    if (!categoryByValue.has(value)) {
      categoryByValue.set(value, {
        value,
        label: TICKET_CATEGORY_LABEL[value] ?? value,
        sort: 10_000,
        tenantScoped: false,
      });
    }
  }
  if (categoryByValue.size === 0) {
    for (const category of staticCategoryOptions) {
      categoryByValue.set(category.value, { ...category, tenantScoped: false });
    }
  }
  const categoryOptions = [...categoryByValue.values()]
    .sort((left, right) => left.sort - right.sort || left.label.localeCompare(right.label, "tr-TR"))
    .map(({ value, label }) => ({ value, label }));
  const categoryLabels = Object.fromEntries(categoryOptions.map((category) => [category.value, category.label]));
  const statusOptions = TICKET_STATUS_KEYS.map((status) => ({ value: status, label: TICKET_STATUS_LABEL[status] }));
  const filtered = Boolean(filters.q || filters.durum || filters.oncelik || filters.kategori || filters.atanan || filters.tenant || filters.sla);
  const hrefFor = (patch: Partial<Record<keyof TicketListFilters, string | number | null | undefined>>) =>
    buildTicketListHref(filters, patch);
  const metricHrefFor = (patch: Partial<Record<keyof TicketListFilters, string | number | null | undefined>> = {}) =>
    buildTicketListHref({ tenant: filters.tenant, sirala: "queue", yon: "desc", sayfa: 1 }, patch);

  const donutSegments = TICKET_STATUS_KEYS.map((status) => ({
    key: status,
    label: TICKET_STATUS_LABEL[status],
    count: countOf(status),
    color: STATUS_COLOR[status],
    href: hrefFor({ durum: filters.durum === status ? null : status }),
    active: filters.durum === status,
  }));

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="Müşteri operasyon merkezi"
        icon={LifeBuoy}
        title="Destek talepleri"
        art="support"
        description={`SLA, durum ve sorumlu atamalarını tek kuyruktan yönetin.${filtered ? ` ${listTotal} süzülmüş sonuç gösteriliyor.` : ` ${open} aktif talep izleniyor.`}`}
        note={
          metrics.firstResponseBreached > 0 ? (
            <>
              <strong>{metrics.firstResponseBreached} talepte</strong> ilk yanıt SLA süresi aşıldı.{" "}
              <Link href={metricHrefFor({ durum: "acik" })}>Kuyruğu aç</Link>
            </>
          ) : undefined
        }
        actions={
          <>
            <ButtonLink href={filters.tenant ? `/admin/tickets/yeni?tenant=${filters.tenant}` : "/admin/tickets/yeni"} size="lg" variant="primary" icon={LifeBuoy}>
              Yeni talep
            </ButtonLink>
            <ExportButton action={exportTicketsCsv} label="CSV dışa aktar" />
            <ButtonLink href="/admin/tickets/makrolar" size="lg" variant="outline">
              Hazır yanıtlar
            </ButtonLink>
          </>
        }
      />

      <KpiGrid label="Destek özeti">
        <MetricCard label="Toplam talep" value={total} hint="Tüm zamanlar" icon={Inbox} tone="brand" href={metricHrefFor()} />
        <MetricCard
          label="Açık kuyruk"
          value={open}
          hint={metrics.firstResponseBreached > 0 ? `${metrics.firstResponseBreached} ilk yanıt SLA aşımı` : "Aktif ve bekleyen"}
          icon={Clock3}
          tone="amber"
          href={metricHrefFor({ durum: "acik" })}
        />
        <MetricCard label="Acil talep" value={urgent} hint={urgent > 0 ? "Öncelikli müdahale" : "Kritik bekleyen yok"} icon={Siren} tone="danger" href={metricHrefFor({ oncelik: "urgent", durum: "acik" })} />
        <MetricCard label="Ort. çözüm süresi" value={averageLabel} hint="Tüm sonuçlanan kayıtlardan" icon={TimerReset} tone="cyan" />
        <MetricCard label="Çözüm oranı" value={`%${solveRate}`} hint={`${resolved}/${total} sonuçlandırıldı`} icon={CheckCircle2} tone="mint" href={metricHrefFor({ durum: "cozulmus" })} />
      </KpiGrid>

      <section aria-label="Destek analitiği" className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-[0.95fr_1.45fr_0.9fr]">
        <TicketStatusDonut segments={donutSegments} total={total} />

        <section className="surface-card min-w-0 rounded-[var(--radius-panel)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">Talep akışı</p>
              <h2 className="mt-1 font-display text-base font-extrabold text-ink-950">Son 14 gün · yeni talepler</h2>
              <p className="mt-0.5 text-xs text-text-muted">Günlük oluşturulan destek talebi</p>
            </div>
            <span className="rounded-[var(--radius-control)] bg-brand-600/[0.07] px-2.5 py-1.5 text-right">
              <span className="numeric block font-display text-lg font-extrabold leading-none text-brand-700">{newLast14}</span>
              <span className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">14 gün</span>
            </span>
          </div>
          <div className="mt-4">
            <InteractiveChart
              data={dailyNew}
              color="var(--brand-600)"
              name="Yeni talep"
              format="number"
              height={146}
              labelEvery={3}
              showLegend={false}
            />
          </div>
        </section>

        <TicketResolutionGauge
          rate={solveRate}
          resolved={resolved}
          total={total}
          averageLabel={averageLabel}
          href={metricHrefFor({ durum: "cozulmus" })}
        />
      </section>

      <section className="surface-card overflow-hidden rounded-[var(--radius-panel)]">
        <nav aria-label="Talep durumları" className="border-b border-hairline bg-canvas/65 px-2 py-2">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto pb-0.5">
            <Link href={hrefFor({ durum: null })} aria-current={!filters.durum ? "page" : undefined} className={statusPillClass(!filters.durum)}>
              Tümü <StatusCount count={total} active={!filters.durum} />
            </Link>
            <Link href={hrefFor({ durum: "acik" })} aria-current={filters.durum === "acik" ? "page" : undefined} className={statusPillClass(filters.durum === "acik")}>
              Açık kuyruk <StatusCount count={open} active={filters.durum === "acik"} />
            </Link>
            {TICKET_STATUS_KEYS.map((status) => {
              const active = filters.durum === status;
              return (
                <Link key={status} href={hrefFor({ durum: active ? null : status })} aria-current={active ? "page" : undefined} className={statusPillClass(active)}>
                  {TICKET_STATUS_LABEL[status]} <StatusCount count={countOf(status)} active={active} />
                </Link>
              );
            })}
            <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
            <Link
              href={hrefFor({ atanan: filters.atanan === currentStaff.id ? null : currentStaff.id })}
              aria-current={filters.atanan === currentStaff.id ? "page" : undefined}
              className={statusPillClass(filters.atanan === currentStaff.id)}
            >
              Bana atanmış
            </Link>
            <Link
              href={hrefFor({ atanan: filters.atanan === "atanmadi" ? null : "atanmadi" })}
              aria-current={filters.atanan === "atanmadi" ? "page" : undefined}
              className={statusPillClass(filters.atanan === "atanmadi")}
            >
              Atanmamış
            </Link>
            <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
            <Link
              href={hrefFor({ sla: filters.sla === "breached" ? null : "breached", sirala: "queue", yon: "desc" })}
              aria-current={filters.sla === "breached" ? "page" : undefined}
              className={statusPillClass(filters.sla === "breached")}
            >
              SLA aşıldı
            </Link>
            <Link
              href={hrefFor({ sla: filters.sla === "warning" ? null : "warning", sirala: "queue", yon: "desc" })}
              aria-current={filters.sla === "warning" ? "page" : undefined}
              className={statusPillClass(filters.sla === "warning")}
            >
              SLA riskte
            </Link>
            <Link
              href={hrefFor({ sla: filters.sla === "normal" ? null : "normal", sirala: "queue", yon: "desc" })}
              aria-current={filters.sla === "normal" ? "page" : undefined}
              className={statusPillClass(filters.sla === "normal")}
            >
              SLA normal
            </Link>
          </div>
        </nav>

        <form
          action="/admin/tickets"
          role="search"
          className="grid items-end gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(110px,0.65fr))_auto]"
        >
          {filters.durum ? <input type="hidden" name="durum" value={filters.durum} /> : null}
          {filters.tenant ? <input type="hidden" name="tenant" value={filters.tenant} /> : null}
          {filters.sla ? <input type="hidden" name="sla" value={filters.sla} /> : null}
          <div className="relative min-w-0 sm:col-span-2 xl:col-span-2 2xl:col-span-1">
            <label htmlFor="ticket-search" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Ara</label>
            <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-text-faint" aria-hidden />
            <input
              id="ticket-search"
              name="q"
              type="search"
              defaultValue={filters.q}
              minLength={2}
              maxLength={80}
              placeholder="Talep no, konu veya ofis…"
              className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas pl-9 pr-3 text-sm text-ink-950 outline-none transition placeholder:text-text-faint focus:border-brand-400 focus:bg-surface"
            />
          </div>

          <div>
            <label htmlFor="ticket-priority" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Öncelik</label>
            <select id="ticket-priority" name="oncelik" defaultValue={filters.oncelik ?? ""} className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
              <option value="">Tüm öncelikler</option>
              {TICKET_PRIORITY_KEYS.map((priority) => <option key={priority} value={priority}>{TICKET_PRIORITY_LABEL[priority]}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="ticket-category" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Kategori</label>
            <select id="ticket-category" name="kategori" defaultValue={filters.kategori ?? ""} className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
              <option value="">Tüm kategoriler</option>
              {categoryOptions.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="ticket-assignee" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Atanan</label>
            <select id="ticket-assignee" name="atanan" defaultValue={filters.atanan ?? ""} className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
              <option value="">Tüm personel</option>
              <option value="atanmadi">Atanmamış</option>
              {staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
            </select>
          </div>

          {filters.sla ? (
            <>
              <input type="hidden" name="sirala" value="queue" />
              <input type="hidden" name="yon" value="desc" />
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Sıralama</span>
                <div className="flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950">
                  SLA riskine göre otomatik sıralanır
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="ticket-sort" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Sıralama</label>
                <select id="ticket-sort" name="sirala" defaultValue={filters.sirala ?? "queue"} className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                  <option value="queue">SLA öncelikli kuyruk</option>
                  <option value="created_at">Oluşturma</option>
                  <option value="updated_at">Son hareket</option>
                  <option value="subject">Konu</option>
                  <option value="status">Durum</option>
                </select>
              </div>

              <div>
                <label htmlFor="ticket-direction" className="mb-1 block text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Yön</label>
                <select id="ticket-direction" name="yon" defaultValue={filters.yon ?? "desc"} className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                  <option value="desc">Azalan</option>
                  <option value="asc">Artan</option>
                </select>
              </div>
            </>
          )}

          <Button type="submit" size="md" className="h-10 justify-self-start sm:col-span-2 xl:col-span-3 2xl:col-span-1">Uygula</Button>
        </form>

        {(filtered || selectedTenant) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2.5">
            <span className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Aktif görünüm</span>
            {selectedTenant ? (
              <Link href={hrefFor({ tenant: null })} className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/[0.08] px-2.5 py-1 text-xs font-bold text-brand-700">
                {selectedTenant.name} <X className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
            {filters.sla ? (
              <Link href={hrefFor({ sla: null })} className="focus-ring inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2.5 py-1 text-xs font-bold text-amber-700">
                {SLA_FILTER_LABEL[filters.sla]} <X className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
            <span className="numeric text-xs font-semibold text-text-muted">{listTotal.toLocaleString("tr-TR")} sonuç</span>
            <Link href="/admin/tickets" className="focus-ring ml-auto rounded-[var(--radius-control)] px-2 py-1 text-xs font-bold text-danger-600 transition hover:bg-danger-500/[0.06]">Filtreleri temizle</Link>
          </div>
        ) : null}
      </section>

      <TicketQueueView
        key={rows.map((row) => row.id).join(":")}
        rows={rows}
        staff={staff}
        statusOptions={statusOptions}
        categoryLabels={categoryLabels}
        filters={filters}
        filtered={filtered}
      />

      <Pagination
        page={page}
        total={listTotal}
        hrefFor={(nextPage) => buildTicketListHref(filters, { sayfa: nextPage })}
      />
    </div>
  );
}
