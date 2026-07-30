import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, LifeBuoy, Siren, TrendingUp, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { daysAgoIso } from "@/lib/clock";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { CountUp } from "@/components/admin/count-up";
import { slaSortRank, slaStateOf } from "./sla";
import { SlaBadge } from "./sla-badge";
import { TicketRowActions } from "./ticket-row-actions";
import { Tilt3D } from "./tilt-3d";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

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
  closed: "rgba(10,18,36,0.25)",
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

const priorityColor: Record<string, string> = {
  low: "rgba(10,18,36,0.2)",
  normal: "var(--brand-500)",
  high: "var(--amber-400)",
  urgent: "var(--danger-500)",
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

const chipCls = (active: boolean) =>
  `focus-ring press lift rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
    active
      ? "border border-ink-950 bg-ink-950 text-white shadow-[var(--elev-2)]"
      : "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950 hover:shadow-[var(--shadow-xs)]"
  }`;

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

  // Halka/barlar her zaman tüm kuyruğu gösterir — filtre yalnızca listeyi daraltır
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
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: stats.filter((t) => t.status === k).length,
    color: statusColor[k],
  }));
  const total = Math.max(1, stats.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });

  const priorityKeys = ["urgent", "high", "normal", "low"] as const;
  const priorityCounts = priorityKeys.map((k) => ({
    key: k,
    count: stats.filter((t) => t.priority === k).length,
    color: priorityColor[k],
  }));
  const maxPri = Math.max(1, ...priorityCounts.map((p) => p.count));

  // --- Ultra-premium: çözüm oranı, ort. çözüm süresi, 14 günlük zaman serisi ---
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
            (s, t) =>
              s + Math.max(0, new Date(t.resolved_at as string).getTime() - new Date(t.created_at as string).getTime()) / 3_600_000,
            0,
          ) / resolvedWithTime.length,
        )
      : null;
  const avgResolveLabel =
    avgResolveHours == null ? "—" : avgResolveHours >= 48 ? `${Math.round(avgResolveHours / 24)} gün` : `${avgResolveHours} sa`;

  // Son 14 gün · günlük yeni talep. clock kuralı: bileşende Date.now() yok →
  // gün anahtarları daysAgoIso ile üretilir, created_at YYYY-MM-DD ile eşlenir.
  const dayKeys = Array.from({ length: 14 }, (_, i) => daysAgoIso(13 - i).slice(0, 10)); // eskiden yeniye
  const dailyMap = new Map<string, number>(dayKeys.map((k) => [k, 0]));
  for (const t of stats) {
    const k = String(t.created_at).slice(0, 10);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + 1);
  }
  const dailyNew = dayKeys.map((k) => ({ label: `${k.slice(8, 10)}.${k.slice(5, 7)}`, value: dailyMap.get(k) ?? 0 }));
  const newLast14 = dailyNew.reduce((s, d) => s + d.value, 0);

  const statusOptions = Object.entries(statusLabel).map(([value, label]) => ({ value, label }));

  return (
    <div className="space-y-6">
      <section className="perspective theme-dark relative overflow-hidden rounded-[24px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        {/* Nefes alan konik ambient halka — canlı, premium derinlik */}
        <div className="glow-conic glow-breathe pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full opacity-70" />
        <div className="pointer-events-none absolute -right-12 -top-14 h-52 w-52 rounded-full bg-danger-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <span className="rise-in flex items-center gap-2 text-xs font-semibold text-amber-400">
              <LifeBuoy className="h-4 w-4" /> Destek operasyonu
            </span>
            <h1 className="rise-in mt-2 font-display text-2xl font-extrabold text-white" style={{ animationDelay: "60ms" }}>Destek talebi kuyruğu</h1>
            <p className="rise-in mt-1 text-sm text-white/60" style={{ animationDelay: "120ms" }}>
              {stats.length} talep · {open} açık/bekleyen
              {filtered ? ` · listede ${listCount ?? rows.length} sonuç` : ""}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Link
                href={buildHref({ tenant: tenantId })}
                className="rise-in lift focus-ring group relative block overflow-hidden rounded-[16px] border border-white/10 bg-white/[0.06] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-white/25 hover:bg-white/10"
                style={{ animationDelay: "180ms" }}
              >
                <span className="pointer-events-none absolute -right-6 -top-8 h-16 w-16 rounded-full bg-white/10 blur-2xl transition group-hover:bg-white/20" />
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <CountUp value={stats.length} className="font-display text-2xl font-extrabold" />
                <p className="text-[11px] text-white/45">Toplam</p>
              </Link>
              <Link
                href={buildHref({ durum: durum === "acik" ? undefined : "acik", oncelik, tenant: tenantId })}
                aria-current={durum === "acik" ? "page" : undefined}
                className={`rise-in lift focus-ring group relative block overflow-hidden rounded-[16px] border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition ${
                  durum === "acik" ? "border-amber-300/50 bg-amber-300/12" : "border-white/10 bg-white/[0.06] hover:border-white/25 hover:bg-white/10"
                }`}
                style={{ animationDelay: "240ms" }}
              >
                <span className="pointer-events-none absolute -right-6 -top-8 h-16 w-16 rounded-full bg-amber-400/20 blur-2xl transition group-hover:bg-amber-400/30" />
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <CountUp value={open} className="font-display text-2xl font-extrabold text-amber-300" />
                <p className="text-[11px] text-white/45">Açık kuyruk</p>
              </Link>
              <Link
                href={buildHref({ oncelik: oncelik === "urgent" ? undefined : "urgent", durum, tenant: tenantId })}
                aria-current={oncelik === "urgent" ? "page" : undefined}
                className={`rise-in lift focus-ring group relative block overflow-hidden rounded-[16px] border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition ${
                  oncelik === "urgent" ? "border-danger-400/50 bg-danger-500/12" : "border-white/10 bg-white/[0.06] hover:border-white/25 hover:bg-white/10"
                }`}
                style={{ animationDelay: "300ms" }}
              >
                <span className="pointer-events-none absolute -right-6 -top-8 h-16 w-16 rounded-full bg-danger-500/20 blur-2xl transition group-hover:bg-danger-500/30" />
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <span className="flex items-center gap-1.5">
                  {urgent > 0 ? <span className="status-pulse h-2 w-2 rounded-full bg-danger-400" /> : null}
                  <CountUp value={urgent} className="font-display text-2xl font-extrabold text-danger-400" />
                </span>
                <p className="text-[11px] text-white/45">Acil</p>
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rise-in" style={{ animationDelay: "220ms" }}>
              <Tilt3D max={9} glare={0.2} className="h-full rounded-[18px] border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Durum</p>
                <div className="tilt3d__depth relative mx-auto mt-3 grid h-24 w-24 place-items-center" style={{ ["--tz" as string]: "34px" }}>
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90 drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                    {arcs.filter((a) => a.count > 0).map((a) => (
                      <circle
                        key={a.key}
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={a.color}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                        strokeDashoffset={-a.offset}
                        className="ring-sweep"
                        style={{ "--circ": RING_C, "--dash": RING_C - a.dash } as CSSProperties}
                      />
                    ))}
                  </svg>
                  <div className="absolute text-center">
                    <CountUp value={open} className="block font-display text-lg font-extrabold leading-none" />
                    <p className="text-[8px] text-white/40">açık</p>
                  </div>
                </div>
                <div className="mt-3 space-y-0.5 text-[11px]">
                  {statusCounts.map((s) => {
                    const active = durum === s.key;
                    return (
                      <Link
                        key={s.key}
                        href={buildHref({ durum: active ? undefined : s.key, oncelik, tenant: tenantId })}
                        aria-current={active ? "page" : undefined}
                        className={`focus-ring flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 transition ${
                          active ? "bg-white/12 text-white" : "text-white/60 hover:bg-white/6 hover:text-white"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full ring-2 ring-white/10" style={{ background: s.color }} />
                        <span className={`flex-1 ${active ? "font-bold" : ""}`}>{s.label}</span>
                        <span className="font-bold text-white">{s.count}</span>
                      </Link>
                    );
                  })}
                </div>
              </Tilt3D>
            </div>
            <div className="rise-in" style={{ animationDelay: "300ms" }}>
              <Tilt3D max={9} glare={0.2} className="h-full rounded-[18px] border border-white/10 bg-white/[0.05] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur">
                <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                  <Siren className="h-3 w-3 text-danger-400" /> Öncelik
                </p>
                <div className="tilt3d__depth flex h-28 items-end gap-2" style={{ ["--tz" as string]: "26px" }}>
                  {priorityCounts.map((p, i) => {
                    const active = oncelik === p.key;
                    return (
                      <Link
                        key={p.key}
                        href={buildHref({ oncelik: active ? undefined : p.key, durum, tenant: tenantId })}
                        aria-current={active ? "page" : undefined}
                        title={active ? "Öncelik filtresini kaldır" : `Yalnızca "${priorityLabel[p.key]}" öncelikli talepler`}
                        className={`focus-ring press flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-[8px] pb-1 transition ${
                          active ? "bg-white/12" : "hover:bg-white/6"
                        }`}
                      >
                        <span className="text-[10px] font-bold text-white/80">{p.count}</span>
                        <div
                          className="bar-live w-full max-w-[22px] origin-bottom rounded-t-[5px] shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                          style={{
                            height: `${Math.max((p.count / maxPri) * 70, 8)}%`,
                            background: `linear-gradient(180deg, ${p.color}, ${p.color}cc)`,
                            animationDelay: `${i * 0.1}s`,
                          }}
                        />
                        <span className={`text-[8px] ${active ? "font-bold text-white" : "text-white/35"}`}>
                          {priorityLabel[p.key]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </Tilt3D>
            </div>
          </div>
        </div>
      </section>

      {/* Talep akışı + performans — zaman serisi ve çözüm metrikleri */}
      <section className="perspective grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="rise-in" style={{ animationDelay: "80ms" }}>
          <Tilt3D max={4} glare={0.1} perspective={1600} className="card-hover h-full rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                  <TrendingUp className="h-4 w-4" /> Talep akışı
                </p>
                <h2 className="mt-0.5 font-display text-base font-bold text-ink-950">Son 14 gün · yeni destek talebi</h2>
              </div>
              <CountUp value={newLast14} className="font-display text-2xl font-extrabold tabular-nums text-brand-600" />
            </div>
            <InteractiveChart
              data={dailyNew}
              color="var(--brand-600)"
              name="Yeni talep"
              format="number"
              height={180}
              labelEvery={2}
              className="mt-4"
            />
          </Tilt3D>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <div className="rise-in" style={{ animationDelay: "160ms" }}>
            <Tilt3D max={8} glare={0.12} className="group h-full overflow-hidden rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
              <span className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-mint-500/10 blur-2xl transition group-hover:bg-mint-500/20" />
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <CheckCircle2 className="h-4 w-4" /> Çözüm oranı
              </p>
              <p className="tilt3d__depth mt-2 font-display text-4xl font-extrabold leading-none text-ink-950" style={{ ["--tz" as string]: "30px" }}>
                <CountUp value={resolutionRate} prefix="%" />
              </p>
              <p className="mt-1 text-xs text-text-muted">{resolvedCount}/{totalReal} talep çözüldü/kapandı</p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line">
                <div className="bar-live h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--mint-400),var(--mint-500))]" style={{ width: `${resolutionRate}%` }} />
              </div>
            </Tilt3D>
          </div>
          <div className="rise-in" style={{ animationDelay: "240ms" }}>
            <Tilt3D max={8} glare={0.12} className="group h-full overflow-hidden rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
              <span className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-brand-600/10 blur-2xl transition group-hover:bg-brand-600/20" />
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <Clock className="h-4 w-4" /> Ort. çözüm süresi
              </p>
              <p className="tilt3d__depth mt-2 font-display text-4xl font-extrabold leading-none text-ink-950" style={{ ["--tz" as string]: "30px" }}>{avgResolveLabel}</p>
              <p className="mt-1 text-xs text-text-muted">açılıştan çözüme, çözülen taleplerde</p>
            </Tilt3D>
          </div>
        </div>
      </section>

      <nav aria-label="Talep filtreleri" className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-3">
        <Link href={buildHref({ tenant: tenantId })} aria-current={!durum && !oncelik ? "page" : undefined} className={chipCls(!durum && !oncelik)}>
          Tümü
        </Link>
        <Link
          href={buildHref({ durum: "acik", oncelik, tenant: tenantId })}
          aria-current={durum === "acik" ? "page" : undefined}
          className={chipCls(durum === "acik")}
        >
          Açık kuyruk
        </Link>
        {statusKeys.map((k) => (
          <Link
            key={k}
            href={buildHref({ durum: durum === k ? undefined : k, oncelik, tenant: tenantId })}
            aria-current={durum === k ? "page" : undefined}
            className={chipCls(durum === k)}
          >
            {statusLabel[k]}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {priorityKeys.map((k) => (
          <Link
            key={k}
            href={buildHref({ oncelik: oncelik === k ? undefined : k, durum, tenant: tenantId })}
            aria-current={oncelik === k ? "page" : undefined}
            className={chipCls(oncelik === k)}
          >
            {priorityLabel[k]}
          </Link>
        ))}
        {filterTenant ? (
          <Link
            href={buildHref({ durum, oncelik })}
            className="focus-ring ml-auto inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            Ofis: {filterTenant.name} <X className="h-3 w-3" />
          </Link>
        ) : null}
      </nav>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-text-muted">
            {filtered ? "Filtreyle eşleşen destek talebi yok." : "Henüz destek talebi yok."}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((t, i) => (
              <article
                key={t.id}
                className="rise-in group relative flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-brand-600/[0.03] sm:px-5 lg:flex-row lg:items-center lg:gap-4"
                style={{ animationDelay: `${Math.min(i * 45, 520)}ms` }}
              >
                {/* Sol vurgu şeridi — hover'da büyür (premium his) */}
                <span className="pointer-events-none absolute inset-y-2 left-0 w-0.5 origin-center scale-y-0 rounded-full bg-[linear-gradient(180deg,var(--brand-400),var(--brand-600))] transition-transform duration-300 group-hover:scale-y-100" aria-hidden />
                {/* Bilgi */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {t.priority === "urgent" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger-500" /> : null}
                    <Link href={`/admin/tickets/${t.id}`} className="truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      {t.subject}
                    </Link>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-text-muted">{t.body}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-text-faint">
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
                    <span className="whitespace-nowrap">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}</span>
                  </p>
                </div>

                {/* SLA + konuşma */}
                <div className="flex shrink-0 items-center gap-2">
                  <SlaBadge sla={t.sla} />
                  <Link
                    href={`/admin/tickets/${t.id}`}
                    className="focus-ring lift press inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 hover:shadow-[var(--shadow-xs)]"
                  >
                    Konuşma <ArrowUpRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
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

      <Pagination
        page={page}
        total={listCount ?? 0}
        hrefFor={(p) => buildHref({ durum, oncelik, tenant: tenantId, sayfa: p })}
      />
    </div>
  );
}
