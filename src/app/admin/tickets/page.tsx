import Link from "next/link";
import { AlertTriangle, ArrowUpRight, LifeBuoy, Siren, UserCheck, X } from "lucide-react";
import { setTicketStatus } from "@/app/actions/tickets";
import { assignTicketStaffAction } from "@/app/actions/admin-ticket-ops";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { slaSortRank, slaStateOf } from "./sla";
import { SlaBadge } from "./sla-badge";
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
  `focus-ring press rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${
    active ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
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
    admin.from("support_tickets").select("status, priority").limit(2000),
    tenantId
      ? admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
    admin.from("platform_staff").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const fetched = data ?? [];
  const stats = statRows ?? [];
  const filterTenant = tenantRes.data;
  const staff = staffList ?? [];
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]));

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

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-14 h-52 w-52 rounded-full bg-danger-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <LifeBuoy className="h-4 w-4" /> Destek operasyonu
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Destek talebi kuyruğu</h1>
            <p className="mt-1 text-sm text-white/60">
              {stats.length} talep · {open} açık/bekleyen
              {filtered ? ` · listede ${listCount ?? rows.length} sonuç` : ""}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Link
                href={buildHref({ tenant: tenantId })}
                className="focus-ring press group relative block rounded-[14px] border border-white/10 bg-white/5 p-3 transition hover:border-white/25 hover:bg-white/8"
              >
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <p className="font-display text-xl font-extrabold">{stats.length}</p>
                <p className="text-[11px] text-white/45">Toplam</p>
              </Link>
              <Link
                href={buildHref({ durum: durum === "acik" ? undefined : "acik", oncelik, tenant: tenantId })}
                aria-current={durum === "acik" ? "page" : undefined}
                className={`focus-ring press group relative block rounded-[14px] border p-3 transition ${
                  durum === "acik" ? "border-amber-300/50 bg-white/12" : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/8"
                }`}
              >
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <p className="font-display text-xl font-extrabold text-amber-300">{open}</p>
                <p className="text-[11px] text-white/45">Açık kuyruk</p>
              </Link>
              <Link
                href={buildHref({ oncelik: oncelik === "urgent" ? undefined : "urgent", durum, tenant: tenantId })}
                aria-current={oncelik === "urgent" ? "page" : undefined}
                className={`focus-ring press group relative block rounded-[14px] border p-3 transition ${
                  oncelik === "urgent" ? "border-danger-400/50 bg-white/12" : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/8"
                }`}
              >
                <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <p className="flex items-center gap-1.5 font-display text-xl font-extrabold text-danger-400">
                  {urgent > 0 ? <span className="status-pulse h-2 w-2 rounded-full bg-danger-400" /> : null}
                  {urgent}
                </p>
                <p className="text-[11px] text-white/45">Acil</p>
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Durum</p>
              <div className="relative mx-auto mt-3 grid h-24 w-24 place-items-center">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
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
                      strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                      strokeDashoffset={-a.offset}
                      className="ring-sweep"
                      style={{ "--circ": RING_C, "--dash": RING_C - a.dash } as CSSProperties}
                    />
                  ))}
                </svg>
                <div className="absolute text-center">
                  <p className="font-display text-lg font-extrabold">{open}</p>
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
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                      <span className={`flex-1 ${active ? "font-bold" : ""}`}>{s.label}</span>
                      <span className="font-bold text-white">{s.count}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <Siren className="h-3 w-3 text-danger-400" /> Öncelik
              </p>
              <div className="flex h-28 items-end gap-2">
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
                        className="bar-live w-full max-w-[22px] rounded-t-[4px]"
                        style={{
                          height: `${Math.max((p.count / maxPri) * 70, 8)}%`,
                          background: p.color,
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
            </div>
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
            {rows.map((t) => (
              <article key={t.id} className="grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.5fr_1fr_auto] lg:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    {t.priority === "urgent" ? <AlertTriangle className="h-3.5 w-3.5 text-danger-500" /> : null}
                    <Link href={`/admin/tickets/${t.id}`} className="text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      {t.subject}
                    </Link>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{t.body}</p>
                  <p className="mt-2 text-[11px] text-text-faint">
                    {t.tenant_id ? (
                      <Link href={`/admin/tenants/${t.tenant_id}`} className="font-semibold text-brand-600 transition hover:underline">
                        {nameOf(t.tenant as Rel)}
                      </Link>
                    ) : (
                      nameOf(t.tenant as Rel)
                    )}{" "}
                    · {categoryLabel[t.category] ?? t.category} ·{" "}
                    <span className={`font-semibold ${priorityCls[t.priority] ?? ""}`}>{priorityLabel[t.priority] ?? t.priority}</span> ·{" "}
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                    {statusLabel[t.status] ?? t.status}
                  </span>
                  <SlaBadge sla={t.sla} />
                  {t.assigned_staff_id ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/12 px-2.5 py-1 text-[11px] font-bold text-cyan-700">
                      <UserCheck className="h-3 w-3" />
                      {staffName.get(t.assigned_staff_id) ?? "Personel"}
                    </span>
                  ) : null}
                  <Link
                    href={`/admin/tickets/${t.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline"
                  >
                    Konuşma <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="flex flex-col items-start gap-2">
                  <form action={setTicketStatus} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <select name="status" defaultValue={t.status} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400">
                      {Object.entries(statusLabel).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white">
                      Güncelle
                    </button>
                  </form>
                  <form action={assignTicketStaffAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <select
                      name="staff_id"
                      defaultValue={t.assigned_staff_id ?? ""}
                      aria-label="Personel ata"
                      className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400"
                    >
                      <option value="">Atanmadı</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950">
                      Ata
                    </button>
                  </form>
                </div>
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
