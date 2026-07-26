import Link from "next/link";
import { daysAgoIso } from "@/lib/clock";
import { Activity, ArrowUpRight, Building2, Search, ShieldAlert, X } from "lucide-react";
import { startImpersonation } from "@/app/actions/platform";
import { exportTenantsCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { TenantPlanForm } from "@/components/admin/tenant-plan-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

const statusLabel: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "İptal",
};

const statusCls: Record<string, string> = {
  trial: "bg-amber-400/15 text-amber-600",
  active: "bg-mint-500/12 text-mint-600",
  past_due: "bg-warn-500/10 text-warn-500",
  suspended: "bg-danger-500/10 text-danger-500",
  cancelled: "bg-ink-950/8 text-text-muted",
};

const statusTone: Record<string, string> = {
  trial: "var(--amber-400)",
  active: "var(--mint-500)",
  past_due: "var(--warn-500)",
  suspended: "var(--danger-500)",
  cancelled: "rgba(10,18,36,0.25)",
};

function buildHref(p: { q?: string; durum?: string; plan?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.durum) sp.set("durum", p.durum);
  if (p.plan) sp.set("plan", p.plan);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/tenants?${s}` : "/admin/tenants";
}

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; durum?: string; plan?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("tenants");
  const sp = (await searchParams) ?? {};
  const query = (sp.q ?? "").trim();
  const durum = sp.durum && statusLabel[sp.durum] ? sp.durum : undefined;
  const plan = sp.plan && planLabel[sp.plan] ? sp.plan : undefined;
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(query || durum || plan);

  const admin = createAdminClient();

  let tenantQuery = admin
    .from("tenants")
    .select("id, name, slug, plan, status, trial_ends_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (query) tenantQuery = tenantQuery.ilike("name", `%${query}%`);
  if (durum) tenantQuery = tenantQuery.eq("status", durum);
  if (plan) tenantQuery = tenantQuery.eq("plan", plan);

  // Sağlık skoru: son 14 günün audit aktivitesi — tek toplu sorgu, bellekte grupla
  const activitySince = daysAgoIso(14);

  // Halka ve paket barları her zaman TÜM envanteri gösterir — filtre yalnızca listeyi daraltır
  const [{ data: tenants, count: tenantCount }, { data: allTenants }, { data: profiles }, { data: auditRows }] = await Promise.all([
    tenantQuery,
    admin.from("tenants").select("id, plan, status").limit(2000),
    admin.from("profiles").select("tenant_id").limit(2000),
    admin.from("audit_logs").select("tenant_id").gte("created_at", activitySince).limit(10000),
  ]);

  const memberCount = new Map<string, number>();
  (profiles ?? []).forEach((p: { tenant_id: string }) => {
    memberCount.set(p.tenant_id, (memberCount.get(p.tenant_id) ?? 0) + 1);
  });

  const activityCount = new Map<string, number>();
  (auditRows ?? []).forEach((a: { tenant_id: string | null }) => {
    if (!a.tenant_id) return;
    activityCount.set(a.tenant_id, (activityCount.get(a.tenant_id) ?? 0) + 1);
  });

  /** Basit churn/sağlık rozeti: yüksek aktivite yeşil, az amber, sıfır kırmızı. */
  function healthOf(tenantId: string) {
    const n = activityCount.get(tenantId) ?? 0;
    if (n >= 10) return { label: "Aktif", cls: "bg-mint-500/12 text-mint-600", n };
    if (n > 0) return { label: "Sessiz", cls: "bg-amber-400/15 text-amber-600", n };
    return { label: "Riskli", cls: "bg-danger-500/10 text-danger-500", n };
  }

  const rows = tenants ?? [];
  const stats = allTenants ?? [];
  const statusKeys = ["active", "trial", "past_due", "suspended", "cancelled"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: stats.filter((t) => t.status === k).length,
    color: statusTone[k],
  }));
  const total = Math.max(1, stats.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });
  const activeRate = stats.filter((t) => t.status === "active").length / total;

  const planCounts = ["advisor", "office", "professional", "enterprise"].map((p) => ({
    key: p,
    label: planLabel[p],
    count: stats.filter((t) => t.plan === p).length,
  }));
  const maxPlan = Math.max(1, ...planCounts.map((p) => p.count));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <Building2 className="h-4 w-4" /> Ofis envanteri
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Tüm ofisler</h1>
            <p className="mt-1 text-sm text-white/75">
              {filtered ? `${tenantCount ?? rows.length} / ${stats.length} ofis · filtre aktif` : `${stats.length} ofis`} · paket ve durum
              burada yönetilir
            </p>
            <div className="mt-4">
              <ExportButton action={exportTenantsCsv} label="Excel'e aktar" />
            </div>
            <div className="mt-5 flex h-24 items-end gap-2.5">
              {planCounts.map((p, i) => {
                const active = plan === p.key;
                return (
                  <Link
                    key={p.key}
                    href={buildHref({ q: query, durum, plan: active ? undefined : p.key })}
                    aria-current={active ? "page" : undefined}
                    title={active ? "Paket filtresini kaldır" : `Yalnızca ${p.label} paketini göster`}
                    className={`focus-ring press flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-[10px] pb-1 transition ${
                      active ? "bg-white/12" : "hover:bg-white/6"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-white/80">{p.count}</span>
                    <div
                      className="bar-live w-full max-w-[26px] rounded-t-[5px] bg-gradient-to-t from-amber-500 to-amber-300"
                      style={{ height: `${Math.max((p.count / maxPlan) * 70, 8)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                    <span className={`text-[10px] ${active ? "font-bold text-amber-300" : "text-white/65"}`}>{p.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
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
                <p className="font-display text-xl font-extrabold text-white">%{Math.round(activeRate * 100)}</p>
                <p className="text-[10px] text-white/70">aktif</p>
              </div>
            </div>
            <div className="space-y-1 text-xs">
              {statusCounts.map((s) => {
                const active = durum === s.key;
                return (
                  <Link
                    key={s.key}
                    href={buildHref({ q: query, plan, durum: active ? undefined : s.key })}
                    aria-current={active ? "page" : undefined}
                    title={active ? "Durum filtresini kaldır" : `Yalnızca "${s.label}" ofisleri göster`}
                    className={`focus-ring flex items-center gap-2 rounded-[7px] px-1.5 py-0.5 transition ${
                      active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className={`flex-1 ${active ? "font-bold" : ""}`}>{s.label}</span>
                    <span className="font-bold text-white">{s.count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <form className="relative w-full max-w-xs">
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
            {plan ? <input type="hidden" name="plan" value={plan} /> : null}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Ofis adı ara…"
              className="w-full rounded-[10px] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
          </form>
          {query ? (
            <Link
              href={buildHref({ durum, plan })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Arama: {query} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {durum ? (
            <Link
              href={buildHref({ q: query, plan })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Durum: {statusLabel[durum]} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {plan ? (
            <Link
              href={buildHref({ q: query, durum })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Paket: {planLabel[plan]} <X className="h-3 w-3" />
            </Link>
          ) : null}
          <p className="ml-auto flex items-center gap-2 text-xs text-text-muted">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            Değişiklikler anında ofisin paneline yansır. Askıya alma erişimi keser.
          </p>
        </div>
        <div className="divide-y divide-line">
          {rows.map((t, i) => (
            <article
              key={t.id}
              className="grid gap-4 px-5 py-4 transition hover:bg-amber-400/[0.03] lg:grid-cols-[1.4fr_1fr_auto] lg:items-center"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="flex items-start gap-3">
                <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[image:var(--grad-ink)] text-amber-300">
                  <Building2 className="h-4 w-4" />
                  {t.status === "active" ? <span className="status-pulse absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-mint-500" /> : null}
                </span>
                <div>
                  <Link href={`/admin/tenants/${t.id}`} className="group inline-flex items-center gap-1 font-display text-base font-bold text-ink-950 transition hover:text-brand-600">
                    {t.name}
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </Link>
                  <p className="mt-0.5 text-xs text-text-muted">
                    /{t.slug} ·{" "}
                    <Link
                      href={`/admin/members?tenant=${t.id}`}
                      className="font-semibold text-brand-600 transition hover:underline"
                    >
                      {memberCount.get(t.id) ?? 0} üye
                    </Link>{" "}
                    · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.created_at))}
                  </p>
                  {t.trial_ends_at ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                      <Activity className="h-3 w-3" />
                      Deneme bitiş: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.trial_ends_at))}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusCls[t.status] ?? statusCls.trial}`}>
                  {statusLabel[t.status] ?? t.status}
                </span>
                <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                  {planLabel[t.plan] ?? t.plan}
                </span>
                {(() => {
                  const h = healthOf(t.id);
                  return (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${h.cls}`}
                      title={`Son 14 günde ${h.n} işlem (audit log)`}
                    >
                      {h.label}
                    </span>
                  );
                })()}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TenantPlanForm
                  tenantId={t.id}
                  tenantName={t.name}
                  currentPlan={t.plan}
                  currentStatus={t.status}
                  planOptions={Object.entries(planLabel)}
                  statusOptions={Object.entries(statusLabel)}
                />
                <form action={startImpersonation}>
                  <input type="hidden" name="tenant_id" value={t.id} />
                  <button type="submit" className="rounded-[9px] border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-400/20">
                    Ofise gir
                  </button>
                </form>
              </div>
            </article>
          ))}
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-muted">
              {filtered ? "Filtreyle eşleşen ofis bulunamadı." : "Henüz kayıtlı ofis yok."}
            </p>
          ) : null}
        </div>
      </div>

      <Pagination
        page={page}
        total={tenantCount ?? 0}
        hrefFor={(p) => buildHref({ q: query, durum, plan, sayfa: p })}
      />
    </div>
  );
}
