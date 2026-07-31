import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Clock, Inbox, LifeBuoy, Siren, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { daysAgoIso } from "@/lib/clock";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { ExportButton } from "@/components/admin/export-button";
import { ButtonLink } from "@/components/ui/button";
import { exportTicketsCsv } from "@/app/actions/platform-export";
import { slaSortRank, slaStateOf } from "./sla";
import { SlaBadge } from "./sla-badge";
import { TicketRowActions } from "./ticket-row-actions";
import { cn } from "@/lib/utils";

const statusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const statusColor: Record<string, string> = {
  open: "var(--brand-500)",
  in_progress: "var(--cyan-400)",
  waiting: "var(--amber-400)",
  resolved: "var(--mint-500)",
  closed: "rgba(10,18,36,0.28)",
};

const priorityCls: Record<string, string> = {
  low: "text-text-muted",
  normal: "text-brand-600",
  high: "text-amber-600",
  urgent: "text-danger-500",
};

const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

const categoryLabel: Record<string, string> = {
  general: "Genel",
  billing: "Fatura",
  bug: "Hata",
  feature: "Özellik isteği",
  compliance: "Uyum",
  onboarding: "Kurulum",
};

/** Açık kuyruğu tek tıkta filtrelemek için birleşik durum değeri. */
const OPEN_STATUSES = ["open", "in_progress", "waiting"] as const;

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

function buildHref(p: { durum?: string; oncelik?: string; tenant?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.durum) sp.set("durum", p.durum);
  if (p.oncelik) sp.set("oncelik", p.oncelik);
  if (p.tenant) sp.set("tenant", p.tenant);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/tickets?${s}` : "/admin/tickets";
}

/** TEK segment-pill stili — durum + öncelik filtreleri aynı dili konuşur. */
function segCls(active: boolean) {
  return cn(
    "focus-ring press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
    active ? "bg-ink-950 text-white shadow-[var(--shadow-xs)]" : "text-text-muted hover:bg-surface hover:text-ink-950",
  );
}

/** Sayaç rozeti — pill içinde, aktifken beyaz zeminli. */
function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", active ? "bg-white/20 text-white" : "bg-ink-950/6 text-text-muted")}>
      {n}
    </span>
  );
}

/** Kompakt, tıklanabilir KPI kartı — ikon rozeti + değer + etiket, hepsi filtrelenmiş hedefe götürür. */
function MetricTile({
  label,
  value,
  href,
  icon: Icon,
  tone = "default",
  active = false,
  pulse = false,
}: {
  label: string;
  value: string | number;
  href: string;
  icon: LucideIcon;
  tone?: "default" | "amber" | "danger" | "mint";
  active?: boolean;
  pulse?: boolean;
}) {
  const toneCls =
    tone === "amber" ? "text-amber-600" : tone === "danger" ? "text-danger-600" : tone === "mint" ? "text-mint-600" : "text-ink-950";
  const iconToneCls =
    tone === "amber"
      ? "bg-amber-400/12 text-amber-600"
      : tone === "danger"
        ? "bg-danger-500/12 text-danger-600"
        : tone === "mint"
          ? "bg-mint-500/12 text-mint-600"
          : "bg-brand-600/10 text-brand-600";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "lift focus-ring group inline-flex items-center gap-2.5 rounded-xl border px-3 py-2 transition",
        active ? "border-ink-950 bg-ink-950/[0.04]" : "border-line bg-surface hover:border-brand-300/60 hover:bg-canvas",
      )}
    >
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-105", iconToneCls)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={cn("font-display text-base font-extrabold leading-none tabular-nums", toneCls)}>
          {pulse ? <span className="status-pulse mr-1 inline-block h-1.5 w-1.5 rounded-full bg-danger-500 align-middle" /> : null}
          {value}
        </span>
        <span className="text-[11px] font-medium text-text-muted">{label}</span>
      </span>
    </Link>
  );
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; oncelik?: string; tenant?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("tickets");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum && (statusLabel[sp.durum] || sp.durum === "acik") ? sp.durum : undefined;
  const oncelik = sp.oncelik && priorityLabel[sp.oncelik] ? sp.oncelik : undefined;
  const tenantId = (sp.tenant ?? "").trim() || undefined;
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(durum || oncelik || tenantId);

  const admin = createAdminClient();

  let listQuery = admin
    .from("support_tickets")
    .select("id, subject, body, category, priority, status, created_at, tenant_id, assigned_staff_id, tenant:tenants(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (durum === "acik") listQuery = listQuery.in("status", [...OPEN_STATUSES]);
  else if (durum) listQuery = listQuery.eq("status", durum);
  if (oncelik) listQuery = listQuery.eq("priority", oncelik);
  if (tenantId) listQuery = listQuery.eq("tenant_id", tenantId);

  // KPI/sayaçlar her zaman tüm kuyruğu gösterir — filtre yalnızca listeyi daraltır
  const [{ data, count: listCount }, { data: statRows }, tenantRes, { data: staffList }] = await Promise.all([
    listQuery,
    admin.from("support_tickets").select("status, priority, created_at, resolved_at").order("created_at", { ascending: false }).limit(2000),
    tenantId
      ? admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
    admin.from("platform_staff").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const fetched = data ?? [];
  const stats = statRows ?? [];
  const filterTenant = tenantRes.data;
  const staff = staffList ?? [];

  // SLA: sayfadaki ticket'lar için ilk personel yanıtı var mı? (tek sorgu)
  const pageIds = fetched.map((t) => t.id);
  const { data: staffMsgRows } = pageIds.length
    ? await admin
        .from("support_ticket_messages")
        .select("ticket_id")
        .in("ticket_id", pageIds)
        .eq("author_kind", "staff")
    : { data: [] as { ticket_id: string }[] };
  const repliedIds = new Set((staffMsgRows ?? []).map((m) => m.ticket_id));

  // Acil + SLA aşımı öne (sayfa içi sıralama); grup içinde tarih sırası korunur
  const rows = fetched
    .map((t) => ({
      ...t,
      sla: slaStateOf({ status: t.status, createdAt: t.created_at, hasStaffReply: repliedIds.has(t.id) }),
    }))
    .sort((a, b) => slaSortRank(a.priority, a.sla) - slaSortRank(b.priority, b.sla));

  const open = stats.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status)).length;
  const urgent = stats.filter((t) => t.priority === "urgent" && !["resolved", "closed"].includes(t.status)).length;

  const statusKeys = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
  const statusCount = (k: string) => stats.filter((t) => t.status === k).length;
  const priorityKeys = ["urgent", "high", "normal", "low"] as const;
  const priorityCount = (k: string) => stats.filter((t) => t.priority === k).length;

  // Çözüm oranı + ort. çözüm süresi
  const totalReal = stats.length;
  const resolvedCount = stats.filter((t) => t.status === "resolved" || t.status === "closed").length;
  const resolutionRate = totalReal > 0 ? Math.round((resolvedCount / totalReal) * 100) : 0;
  const resolvedWithTime = stats.filter(
    (t) => (t.status === "resolved" || t.status === "closed") && t.resolved_at && t.created_at,
  );
  const avgResolveHours =
    resolvedWithTime.length > 0
      ? Math.round(
          resolvedWithTime.reduce(
            (s, t) => s + Math.max(0, new Date(t.resolved_at as string).getTime() - new Date(t.created_at as string).getTime()) / 3_600_000,
            0,
          ) / resolvedWithTime.length,
        )
      : null;
  const avgResolveLabel =
    avgResolveHours == null ? "—" : avgResolveHours >= 48 ? `${Math.round(avgResolveHours / 24)} gün` : `${avgResolveHours} sa`;

  // Son 14 gün · günlük yeni talep (kompakt sparkline). clock kuralı: daysAgoIso.
  const dayKeys = Array.from({ length: 14 }, (_, i) => daysAgoIso(13 - i).slice(0, 10));
  const dailyMap = new Map<string, number>(dayKeys.map((k) => [k, 0]));
  for (const t of stats) {
    const k = String(t.created_at).slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + 1);
  }
  const dailyNew = dayKeys.map((k) => ({ label: `${k.slice(8, 10)}.${k.slice(5, 7)}`, value: dailyMap.get(k) ?? 0 }));
  const newLast14 = dailyNew.reduce((s, d) => s + d.value, 0);

  const statusOptions = Object.entries(statusLabel).map(([value, label]) => ({ value, label }));
  const resolvedHref = buildHref({ durum: durum === "resolved" ? undefined : "resolved", oncelik, tenant: tenantId });

  return (
    <div className="space-y-3">
      {/* Kompakt komuta başlığı — başlık + tıklanabilir KPI şeridi + trend + CSV */}
      <header className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <LifeBuoy className="h-4 w-4 text-brand-600" /> Destek kuyruğu
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {stats.length} talep · {open} açık/bekleyen{filtered ? ` · listede ${listCount ?? rows.length} sonuç` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MetricTile label="Toplam" value={stats.length} icon={Inbox} href={buildHref({ tenant: tenantId })} active={!filtered} />
          <MetricTile
            label="Açık"
            value={open}
            icon={Clock}
            tone="amber"
            active={durum === "acik"}
            href={buildHref({ durum: durum === "acik" ? undefined : "acik", oncelik, tenant: tenantId })}
          />
          <MetricTile
            label="Acil"
            value={urgent}
            icon={Siren}
            tone="danger"
            pulse={urgent > 0}
            active={oncelik === "urgent"}
            href={buildHref({ oncelik: oncelik === "urgent" ? undefined : "urgent", durum, tenant: tenantId })}
          />
          <ExportButton action={exportTicketsCsv} label="CSV" variant="light" />
        </div>
      </header>

      {/* Profesyonel insights şeridi — durum dağılımı · 14 günlük akış · çözüm performansı */}
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 lg:grid-cols-[1.4fr_1.5fr_1fr]">
        {/* Durum dağılımı — yatay yığılı bar + tıklanabilir açıklama */}
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Durum dağılımı</p>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line">
            {statusKeys.map((k) => {
              const c = statusCount(k);
              if (c === 0) return null;
              return <div key={k} style={{ width: `${(c / Math.max(1, stats.length)) * 100}%`, background: statusColor[k] }} title={`${statusLabel[k]}: ${c}`} />;
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
            {statusKeys.map((k) => {
              const active = durum === k;
              return (
                <Link
                  key={k}
                  href={buildHref({ durum: active ? undefined : k, oncelik, tenant: tenantId })}
                  className={`focus-ring inline-flex items-center gap-1.5 rounded px-1 text-[11px] transition hover:text-ink-950 ${active ? "font-bold text-ink-950" : "text-text-muted"}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor[k] }} />
                  {statusLabel[k]}
                  <span className="font-bold tabular-nums text-ink-950">{statusCount(k)}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 14 günlük akış — kompakt interaktif alan grafiği */}
        <div className="min-w-0 border-t border-line pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div className="mb-1 flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Son 14 gün · yeni talep</p>
            <span className="font-display text-sm font-extrabold tabular-nums text-brand-600">{newLast14}</span>
          </div>
          <InteractiveChart data={dailyNew} color="var(--brand-600)" name="Yeni talep" format="number" height={72} labelEvery={3} />
        </div>

        {/* Çözüm performansı */}
        <div className="min-w-0 border-t border-line pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Çözüm performansı</p>
          <div className="flex items-baseline gap-2">
            <Link href={resolvedHref} className="focus-ring font-display text-2xl font-extrabold leading-none text-mint-600 transition hover:opacity-80">
              %{resolutionRate}
            </Link>
            <span className="text-[11px] text-text-muted">{resolvedCount}/{totalReal} çözüldü</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line">
            <div className="h-full rounded-full bg-mint-500" style={{ width: `${resolutionRate}%` }} />
          </div>
          <p className="mt-2 flex items-baseline gap-1.5 text-[11px] text-text-muted">
            Ort. çözüm süresi <span className="font-display text-sm font-bold text-ink-950">{avgResolveLabel}</span>
          </p>
        </div>
      </section>

      {/* TEK dilde segment filtre çubuğu — durum + öncelik, sayaçlı */}
      <nav aria-label="Talep filtreleri" className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-canvas/50 p-1.5">
        <Link href={buildHref({ tenant: tenantId })} aria-current={!durum && !oncelik ? "page" : undefined} className={segCls(!durum && !oncelik)}>
          Tümü
        </Link>
        <Link
          href={buildHref({ durum: "acik", oncelik, tenant: tenantId })}
          aria-current={durum === "acik" ? "page" : undefined}
          className={segCls(durum === "acik")}
        >
          Açık kuyruk <CountBadge n={open} active={durum === "acik"} />
        </Link>
        {statusKeys.map((k) => {
          const active = durum === k;
          return (
            <Link
              key={k}
              href={buildHref({ durum: active ? undefined : k, oncelik, tenant: tenantId })}
              aria-current={active ? "page" : undefined}
              className={segCls(active)}
            >
              {statusLabel[k]} <CountBadge n={statusCount(k)} active={active} />
            </Link>
          );
        })}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {priorityKeys.map((k) => {
          const active = oncelik === k;
          return (
            <Link
              key={k}
              href={buildHref({ oncelik: active ? undefined : k, durum, tenant: tenantId })}
              aria-current={active ? "page" : undefined}
              className={segCls(active)}
            >
              {priorityLabel[k]} <CountBadge n={priorityCount(k)} active={active} />
            </Link>
          );
        })}
        {filterTenant ? (
          <Link
            href={buildHref({ durum, oncelik })}
            className="focus-ring ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-600/10 px-2.5 py-1.5 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            {filterTenant.name} <X className="h-3 w-3" />
          </Link>
        ) : null}
      </nav>

      {/* Yoğun kuyruk — hızlı taranır satırlar */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-text-muted">
            {filtered ? "Filtreyle eşleşen destek talebi yok." : "Henüz destek talebi yok."}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((t) => (
              <article
                key={t.id}
                className={cn(
                  "flex flex-col gap-2 border-l-2 px-4 py-2.5 transition-colors hover:bg-canvas/50 lg:flex-row lg:items-center lg:gap-4",
                  t.priority === "urgent" ? "border-l-danger-500/50" : "border-l-transparent",
                )}
              >
                {/* Bilgi */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {t.priority === "urgent" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger-500" /> : null}
                    <Link href={`/admin/tickets/${t.id}`} className="truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      {t.subject}
                    </Link>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-text-faint">
                    {t.tenant_id ? (
                      <Link href={`/admin/tenants/${t.tenant_id}`} className="font-semibold text-brand-600 transition hover:underline">
                        {nameOf(t.tenant as Rel)}
                      </Link>
                    ) : (
                      <span>{nameOf(t.tenant as Rel)}</span>
                    )}
                    <span aria-hidden>·</span>
                    <span>{categoryLabel[t.category] ?? t.category}</span>
                    <span aria-hidden>·</span>
                    <span className={`font-semibold ${priorityCls[t.priority] ?? ""}`}>{priorityLabel[t.priority] ?? t.priority}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.created_at))}</span>
                  </p>
                </div>

                {/* SLA + konuşma */}
                <div className="flex shrink-0 items-center gap-2">
                  <SlaBadge sla={t.sla} />
                  <ButtonLink href={`/admin/tickets/${t.id}`} variant="secondary" size="xs" iconRight={ArrowUpRight}>
                    Konuşma
                  </ButtonLink>
                </div>

                {/* Aksiyonlar — durum + atama, değişince otomatik uygulanır (inline) */}
                <TicketRowActions
                  id={t.id}
                  status={t.status}
                  statusOptions={statusOptions}
                  assignedId={t.assigned_staff_id ?? null}
                  staff={staff}
                />
              </article>
            ))}
          </div>
        )}
      </div>

      <Pagination page={page} total={listCount ?? 0} hrefFor={(p) => buildHref({ durum, oncelik, tenant: tenantId, sayfa: p })} />
    </div>
  );
}
