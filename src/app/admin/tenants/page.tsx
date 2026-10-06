import Link from "next/link";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { Activity, AlertTriangle, ArrowUpRight, Building2, CheckCircle2, Database, Hourglass, Plus, Search, Settings2, ShieldAlert, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { startImpersonation } from "@/app/actions/platform";
import { exportTenantsCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { TenantPlanForm } from "@/components/admin/tenant-plan-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import type { CSSProperties } from "react";
import { isPlanId, planLabel } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";

const RING_C = 2 * Math.PI * 42;

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

/** Veri durumu süzgeci (URL `veri=`): demo = örnek veri yüklü (tenants.sample_seeded_at dolu), gercek = yüklü değil. */
const dataStateLabel: Record<string, string> = {
  demo: "Demo veri var",
  gercek: "Gerçek veri",
};

/** Sanal durum: `durum=risk` = gecikmiş + askıda (kontrol paneli "riskli ofis" hedefi). */
const durumLabel: Record<string, string> = { ...statusLabel, risk: "Riskli (gecikmiş + askıda)" };

/** Kayıt tarihi penceresi (`yeni=7|30|90` gün) ve deneme bitişi (`deneme=bitiyor|bitti`, `gun` penceresi). */
const DAY_WINDOWS = new Set(["7", "30", "90"]);
const trialLabel: Record<string, string> = { bitiyor: "Deneme 7 gün içinde bitiyor", bitti: "Denemesi biten" };

type HrefParams = { q?: string; durum?: string; plan?: string; veri?: string; yeni?: string; deneme?: string; gun?: string; sayfa?: number };

function buildHref(p: HrefParams) {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.durum) sp.set("durum", p.durum);
  if (p.plan) sp.set("plan", p.plan);
  if (p.veri) sp.set("veri", p.veri);
  if (p.yeni) sp.set("yeni", p.yeni);
  if (p.deneme) sp.set("deneme", p.deneme);
  if (p.deneme === "bitti" && p.gun) sp.set("gun", p.gun);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/tenants?${s}` : "/admin/tenants";
}

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; durum?: string; plan?: string; veri?: string; yeni?: string; deneme?: string; gun?: string; sayfa?: string; audit?: string }>;
}) {
  const staff = await requirePlatformModule("tenants");
  const canCreate = officeAdminCan(staff.role, "create");
  const canImpersonate =staff.role === "super_admin" || staff.role === "ops" || staff.role === "support";
  const sp = (await searchParams) ?? {};
  const query = (sp.q ?? "").trim();
  const durum = sp.durum && durumLabel[sp.durum] ? sp.durum : undefined;
  const plan = sp.plan && isPlanId(sp.plan) ? sp.plan : undefined;
  const veri = sp.veri && dataStateLabel[sp.veri] ? (sp.veri as "demo" | "gercek") : undefined;
  const auditFailed = sp.audit === "failed";
  const page = parsePage(sp.sayfa);
  const yeni = sp.yeni && DAY_WINDOWS.has(sp.yeni) ? sp.yeni : undefined;
  const deneme = sp.deneme && trialLabel[sp.deneme] ? sp.deneme : undefined;
  const gun = deneme === "bitti" ? (sp.gun && DAY_WINDOWS.has(sp.gun) ? sp.gun : "30") : undefined;
  const filtered = Boolean(query || durum || plan || veri || yeni || deneme);
  // Etkin pencere süzgeçleri her bağlantıda taşınır (filtre kontratı: URL ↔ sunucu sorgusu).
  const href = (p: HrefParams) => buildHref({ yeni, deneme, gun, ...p });

  const admin = createAdminClient();

  let tenantQuery = admin
    .from("tenants")
    .select("id, name, slug, plan, status, trial_ends_at, created_at, sample_seeded_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (query) tenantQuery = tenantQuery.ilike("name", `%${query}%`);
  if (durum === "risk") tenantQuery = tenantQuery.in("status", ["past_due", "suspended"]);
  else if (durum) tenantQuery = tenantQuery.eq("status", durum);
  if (yeni) tenantQuery = tenantQuery.gte("created_at", daysAgoIso(Number(yeni)));
  if (deneme === "bitiyor") tenantQuery = tenantQuery.eq("status", "trial").gte("trial_ends_at", daysAgoIso(0)).lte("trial_ends_at", daysFromNowIso(7));
  if (deneme === "bitti") tenantQuery = tenantQuery.gte("trial_ends_at", daysAgoIso(Number(gun))).lte("trial_ends_at", daysAgoIso(0));
  if (plan) tenantQuery = tenantQuery.eq("plan", plan);
  // Filtre kontratı: URL'deki `veri` sunucu sorgusuna yansır (demo = damga dolu, gercek = damga boş).
  if (veri === "demo") tenantQuery = tenantQuery.not("sample_seeded_at", "is", null);
  if (veri === "gercek") tenantQuery = tenantQuery.is("sample_seeded_at", null);

  // Sağlık skoru: son 14 günün audit aktivitesi — tek toplu sorgu, bellekte grupla
  const activitySince = daysAgoIso(14);

  // Halka ve paket barları her zaman TÜM envanteri gösterir — filtre yalnızca listeyi daraltır
  const [{ data: tenants, count: tenantCount }, { data: allTenants }, { data: profiles }, { data: auditRows }] = await Promise.all([
    tenantQuery,
    admin.from("tenants").select("id, plan, status, sample_seeded_at").limit(2000),
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
  const demoCount = stats.filter((t) => Boolean((t as { sample_seeded_at?: string | null }).sample_seeded_at)).length;

  // Gizli planlar (örn. Business) yalnız bu planda ofis varsa listelenir; sayım hiçbir ofisi düşürmez.
  const planDefs = await getPlanDefinitions();
  const planCounts = planDefs
    .map((catalogPlan) => ({
      key: catalogPlan.id,
      label: catalogPlan.name,
      hidden: Boolean(catalogPlan.hidden),
      count: stats.filter((t) => t.plan === catalogPlan.id).length,
    }))
    .filter((p) => !p.hidden || p.count > 0);
  const maxPlan = Math.max(1, ...planCounts.map((p) => p.count));

  return (
    <div className="space-y-6">
      {auditFailed ? (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-danger-500/25 bg-danger-500/8 px-4 py-3 text-sm text-danger-600">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">Destek oturumu kapatıldı ancak denetim kaydı doğrulanamadı.</p>
              <p className="mt-0.5 text-xs text-danger-600/85">Güvenlik ekibi hata kayıtlarını kontrol etmelidir; yeni impersonation başlatmadan önce olay kaydını doğrulayın.</p>
            </div>
          </div>
          <Link href="/admin/tenants" aria-label="Uyarıyı kapat" className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] hover:bg-danger-500/10">
            <X className="h-4 w-4" />
          </Link>
        </div>
      ) : null}
      <AdminPageHeader
        eyebrow="Ofis envanteri"
        icon={Building2}
        title="Tüm ofisler"
        description={`${filtered ? `${tenantCount ?? rows.length} / ${stats.length} ofis · filtre aktif` : `${stats.length} ofis`} · paket ve durum burada yönetilir`}
        actions={
          <>
            {canCreate ? (
              <Link
                href="/admin/tenants/yeni"
                className="focus-ring press inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
              >
                <Plus className="h-4 w-4" aria-hidden /> Yeni ofis
              </Link>
            ) : null}
            <ExportButton action={exportTenantsCsv} label="Excel'e aktar" variant="light" />
          </>
        }
      >
        <KpiGrid label="Ofis göstergeleri" className="lg:grid-cols-5 2xl:grid-cols-5">
          <KpiCard layout="inline" label="Toplam ofis" value={stats.length} href={buildHref({})} icon={Building2} tone="brand" />
          <KpiCard layout="inline" label="Aktif" value={statusCounts[0].count} href={href({ q: query, plan, veri, durum: "active" })} icon={CheckCircle2} tone="success" />
          <KpiCard layout="inline" label="Denemede" value={statusCounts[1].count} href={href({ q: query, plan, veri, durum: "trial" })} icon={Hourglass} tone="gold" />
          <KpiCard layout="inline" label="Demo veri var" value={demoCount} href={href({ q: query, plan, durum, veri: veri === "demo" ? undefined : "demo" })} icon={Database} tone="neutral" />
          <KpiCard
            layout="inline"
            label="Askıda / gecikmiş"
            value={statusCounts[2].count + statusCounts[3].count}
            href={href({ q: query, plan, veri, durum: "risk" })}
            icon={AlertTriangle}
            tone="danger"
            attention={statusCounts[2].count + statusCounts[3].count > 0}
          />
        </KpiGrid>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <section aria-label="Pakete göre ofis dağılımı" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <p className="text-xs font-semibold text-text-muted">Paket dağılımı</p>
            <div className="mt-2 flex h-24 items-end gap-2.5">
              {planCounts.map((p) => {
                const active = plan === p.key;
                return (
                  <Link
                    key={p.key}
                    href={href({ q: query, durum, veri, plan: active ? undefined : p.key })}
                    aria-current={active ? "page" : undefined}
                    title={active ? "Paket filtresini kaldır" : `Yalnızca ${p.label} paketini göster`}
                    className={`focus-ring press flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-[var(--radius-control)] pb-1 transition ${
                      active ? "bg-accent/10" : "hover:bg-canvas"
                    }`}
                  >
                    <span className="text-xs font-bold text-ink-950">{p.count}</span>
                    <div
                      className="w-full max-w-[26px] rounded-t-[5px] bg-gradient-to-t from-[var(--gold-500)] to-[var(--gold-300)]"
                      style={{ height: `${Math.max((p.count / maxPlan) * 70, 8)}%` }}
                    />
                    <span className={`text-xs ${active ? "font-bold text-accent-text" : "text-text-muted"}`}>{p.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section aria-label="Duruma göre ofis dağılımı" className="flex items-center gap-5 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <div className="relative grid h-28 w-28 shrink-0 place-items-center">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-sunken)" strokeWidth="10" />
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
                <p className="font-display text-xl font-extrabold text-ink-950">%{Math.round(activeRate * 100)}</p>
                <p className="text-xs text-text-muted">aktif</p>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-xs">
              {statusCounts.map((s) => {
                const active = durum === s.key;
                return (
                  <Link
                    key={s.key}
                    href={href({ q: query, plan, veri, durum: active ? undefined : s.key })}
                    aria-current={active ? "page" : undefined}
                    title={active ? "Durum filtresini kaldır" : `Yalnızca "${s.label}" ofisleri göster`}
                    className={`focus-ring flex items-center gap-2 rounded-[7px] px-1.5 py-0.5 transition ${
                      active ? "bg-accent/10 text-ink-950" : "text-text-muted hover:bg-canvas hover:text-ink-950"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className={`flex-1 ${active ? "font-bold" : ""}`}>{s.label}</span>
                    <span className="font-bold text-ink-950">{s.count}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      </AdminPageHeader>

      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <form className="relative w-full max-w-xs">
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
            {plan ? <input type="hidden" name="plan" value={plan} /> : null}
            {veri ? <input type="hidden" name="veri" value={veri} /> : null}
            {yeni ? <input type="hidden" name="yeni" value={yeni} /> : null}
            {deneme ? <input type="hidden" name="deneme" value={deneme} /> : null}
            {gun ? <input type="hidden" name="gun" value={gun} /> : null}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Ofis adı ara…"
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-8 py-2 text-sm outline-none focus:border-brand-400"
            />
          </form>
          {query ? (
            <Link
              href={href({ durum, plan, veri })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Arama: {query} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {durum ? (
            <Link
              href={href({ q: query, plan, veri })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Durum: {durumLabel[durum]} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {plan ? (
            <Link
              href={href({ q: query, durum, veri })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Paket: {planLabel(plan)} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {veri ? (
            <Link
              href={href({ q: query, durum, plan })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Veri: {dataStateLabel[veri]} <X className="h-3 w-3" />
            </Link>
          ) : null}
          {yeni ? (
            <Link
              href={buildHref({ q: query, durum, plan, veri, deneme, gun })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              Kayıt: son {yeni} gün <X className="h-3 w-3" />
            </Link>
          ) : null}
          {deneme ? (
            <Link
              href={buildHref({ q: query, durum, plan, veri, yeni })}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
            >
              {trialLabel[deneme]}
              {deneme === "bitti" ? ` · son ${gun} gün` : ""} <X className="h-3 w-3" />
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
                <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] text-amber-300">
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
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                      <Activity className="h-3 w-3" />
                      Deneme bitiş: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.trial_ends_at))}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusCls[t.status] ?? statusCls.trial}`}>
                  {statusLabel[t.status] ?? t.status}
                </span>
                <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                  {planLabel(t.plan)}
                </span>
                {/* Veri durumu: deneme (status) ayrı rozet; burada örnek veri var mı (tenants.sample_seeded_at). Tıklanınca süzer. */}
                <Link
                  href={href({ q: query, durum, plan, veri: t.sample_seeded_at ? "demo" : "gercek" })}
                  className={`focus-ring rounded-full px-2.5 py-1 text-xs font-bold ${t.sample_seeded_at ? "bg-amber-400/15 text-amber-600" : "bg-mint-500/12 text-mint-600"}`}
                  title={t.sample_seeded_at ? "Ofiste örnek (demo) veri yüklü; gerçek kullanıma geçmedi" : "Örnek veri yok: ofis gerçek verisiyle çalışıyor"}
                >
                  {t.sample_seeded_at ? dataStateLabel.demo : dataStateLabel.gercek}
                </Link>
                {(() => {
                  const h = healthOf(t.id);
                  return (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${h.cls}`}
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
                  planOptions={planDefs
                    .filter((catalogPlan) => !catalogPlan.hidden || catalogPlan.id === t.plan)
                    .map((catalogPlan) => [catalogPlan.id, catalogPlan.name] as [string, string])}
                  statusOptions={Object.entries(statusLabel)}
                />
                <Link
                  href={`/admin/tenants/${t.id}?sekme=yonetim`}
                  className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-950 transition hover:bg-canvas"
                >
                  <Settings2 className="h-3.5 w-3.5" /> Yönet
                </Link>
                {canImpersonate ? (
                  <form action={startImpersonation}>
                    <input type="hidden" name="tenant_id" value={t.id} />
                    <button type="submit" className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-400/20">
                      Ofise gir
                    </button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-text-muted">
              <p>{filtered ? "Filtreyle eşleşen ofis bulunamadı." : "Henüz kayıtlı ofis yok."}</p>
              {filtered ? (
                <Link href="/admin/tenants" className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
                  Filtreleri temizle
                </Link>
              ) : canCreate ? (
                <Link href="/admin/tenants/yeni" className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
                  İlk ofisi ekle
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Pagination
        page={page}
        total={tenantCount ?? 0}
        hrefFor={(p) => href({ q: query, durum, plan, veri, sayfa: p })}
      />
    </div>
  );
}
