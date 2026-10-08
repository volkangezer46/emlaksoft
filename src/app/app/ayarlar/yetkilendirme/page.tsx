import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowUpRight, Fingerprint, ScrollText, ShieldCheck, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppModule } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/role-labels";
import { ICONS } from "@/lib/icons";
import { daysAgoIso, daysFromNowIso, now, trDayKey } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { getSetting } from "@/lib/settings/read";
import { SCOPE_ENFORCEMENT_KEY } from "@/lib/settings/registry/tenant";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { StatRow } from "@/components/ui/stat-row";
import { Alert } from "@/components/ui/alert";
import { FilterDate, FilterGrid, FilterSelect, ListPager, pageWindow, parsePage } from "@/components/ui/list-kit";
import { MODULE_LABELS } from "../roller/role-permissions-matrix";
import { listAccessAudit } from "@/app/actions/access-control";
import {
  AUDIT_CHANGE_LABELS,
  OVERRIDE_RESOURCE_LABELS,
  isCustomScope,
  isOverrideExpired,
  isScopeEditorRole,
  type ScopeInput,
} from "@/lib/access-control/admin-rules";
import { accessAuditFiltersToParams, hasAccessAuditFilter, normalizeAccessAuditFilters } from "@/lib/access-control/audit-filters";
import type { ScopeOverride } from "@/lib/access-control/types";
import { ScopeEnforcementToggle } from "./scope-enforcement-toggle";
import { ScopeTable, type NamedRef, type ScopeMember } from "./scope-table";
import { OverrideManager, type OverrideListRow, type OverrideMember } from "./override-manager";
import { UserExceptions, type ExceptionMember, type OverrideRow } from "./user-exceptions";

export const metadata = { title: "Yetkilendirme" };

const PATH = "/app/ayarlar/yetkilendirme";
const TABS = ["kapsamlar", "istisnalar", "izinler", "gunluk"] as const;
type Tab = (typeof TABS)[number];
const AUDIT_PAGE_SIZE = 50;

/** Kişi bazlı izin matrisinde gösterilen modüller (roller ekranıyla aynı liste). */
const MODULES: AppModule[] = [
  "dashboard", "customers", "demands", "properties", "matching", "portals", "leak", "appointments", "calls", "commissions",
  "tasks", "team", "support", "settings", "billing", "reports", "valuation", "compliance", "campaigns", "contracts",
  "expenses", "offers", "targets", "open_house", "rentals", "projects", "network", "surveys", "earnings_all", "office_center",
];

type ProfileRow = { id: string; full_name: string; role: string; is_active: boolean; branch_id: string | null; team_id?: string | null };
type ScopeRow = ScopeInput & { user_id: string };
type OverrideDbRow = {
  id: string; user_id: string; resource_type: ScopeOverride["resource_type"]; resource_id: string; allowed: boolean;
  reason: string | null; expires_at: string | null; created_by: string; created_at: string;
};

const MISSING = new Set(["42P01", "PGRST205", "PGRST204"]);

const RESOURCE_HREF: Record<ScopeOverride["resource_type"], string | null> = {
  demand: "/app/talepler",
  property: "/app/portfoyler",
  portfolio: "/app/portfoyler",
  deal: "/app/anlasmalar",
  commission: "/app/komisyon",
};

/**
 * Yetkilendirme: kullanıcı kapsamları · kapsam istisnaları · kişi bazlı izin istisnaları · denetim günlüğü.
 * Kapı: `settings` modülü (roller ekranıyla aynı; ayrı `roles` modülü yok). Yazma yalnız owner/gm (client + action).
 */
export default async function AccessControlPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string; user?: string; kullanici?: string; yapan?: string; tur?: string; from?: string; to?: string; sayfa?: string }>;
}) {
  const ctx = await requireModulePage("settings", PATH);
  const sp = (await searchParams) ?? {};
  const active: Tab = (TABS as readonly string[]).includes(sp.sekme ?? "") ? (sp.sekme as Tab) : "kapsamlar";
  const canEdit = isScopeEditorRole(ctx.role);
  const supabase = await createClient();
  const nowMs = now();

  // ---- Ortak veri: üyeler, takımlar, şubeler, kapsam satırları, istisnalar ----
  const [teamsRes, branchesRes, scopesRes, overridesRes, enforcement] = await Promise.all([
    supabase.from("teams").select("id, name, is_active").eq("is_active", true).order("name").limit(200),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name").limit(200),
    supabase.from("user_scopes").select("user_id, scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings").limit(1000),
    supabase.from("scope_overrides").select("id, user_id, resource_type, resource_id, allowed, reason, expires_at, created_by, created_at").order("created_at", { ascending: false }).limit(500),
    ctx.tenantId ? getSetting<boolean>(SCOPE_ENFORCEMENT_KEY, { tenantId: ctx.tenantId }) : Promise.resolve(false),
  ]);
  const teamSchemaMissing = Boolean(teamsRes.error);
  const scopeSchemaMissing = Boolean(scopesRes.error && MISSING.has(String(scopesRes.error.code)));
  const membersRes = teamSchemaMissing
    ? await supabase.from("profiles").select("id, full_name, role, is_active, branch_id").order("full_name").limit(500)
    : await supabase.from("profiles").select("id, full_name, role, is_active, branch_id, team_id").order("full_name").limit(500);
  const profiles = ((membersRes.data ?? []) as unknown as ProfileRow[]).filter((p) => p.is_active);
  const nameOf = new Map(profiles.map((p) => [p.id, p.full_name]));
  const teams: NamedRef[] = ((teamsRes.data ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }));
  const branches: NamedRef[] = ((branchesRes.data ?? []) as { id: string; name: string }[]).map((b) => ({ id: b.id, name: b.name }));
  const scopeRows = (scopesRes.error ? [] : ((scopesRes.data ?? []) as ScopeRow[]));
  const scopeByUser = new Map(scopeRows.map((r) => [r.user_id, r]));
  const overrideRows = (overridesRes.error ? [] : ((overridesRes.data ?? []) as OverrideDbRow[]));
  const activeOverrides = overrideRows.filter((o) => !isOverrideExpired(o.expires_at, nowMs));
  const overrideCountByUser = new Map<string, number>();
  for (const o of activeOverrides) overrideCountByUser.set(o.user_id, (overrideCountByUser.get(o.user_id) ?? 0) + 1);

  const members: ScopeMember[] = profiles.map((p) => {
    const row = scopeByUser.get(p.id);
    return {
      id: p.id,
      name: p.full_name,
      role: p.role,
      roleLabel: ROLE_LABELS[p.role] ?? p.role,
      branchId: p.branch_id,
      teamId: p.team_id ?? null,
      scope: row
        ? {
            scope_type: row.scope_type,
            team_id: row.team_id,
            branch_id: row.branch_id,
            can_view_all_data: row.can_view_all_data,
            can_edit_team_members: row.can_edit_team_members,
            can_override_permissions: row.can_override_permissions,
            can_see_earnings: row.can_see_earnings,
          }
        : null,
      overrideCount: overrideCountByUser.get(p.id) ?? 0,
    };
  });

  // ---- KPI: her sayı bir sekmeye gider ----
  const weekAgo = daysAgoIso(7).slice(0, 10);
  const permOverrideUsers = await supabase.from("user_permission_overrides").select("user_id").limit(1000);
  const permUserCount = new Set(((permOverrideUsers.data ?? []) as { user_id: string }[]).map((r) => r.user_id)).size;
  const auditWeek = await listAccessAudit({ from: weekAgo }, 1, 1);
  const stats = [
    { label: "Özel kapsam", value: members.filter((m) => m.scope && isCustomScope(m.role, m.scope)).length, href: `${PATH}?sekme=kapsamlar`, icon: <Users />, hint: "rol varsayılanından sapan üye" },
    { label: "Aktif kapsam istisnası", value: activeOverrides.length, href: `${PATH}?sekme=istisnalar`, icon: <ShieldCheck />, hint: "süresi dolmamış" },
    { label: "İzin istisnası olan üye", value: permUserCount, href: `${PATH}?sekme=izinler`, icon: <Fingerprint />, hint: "modül bazlı kişisel istisna" },
    { label: "Son 7 gün değişiklik", value: auditWeek.total, href: `${PATH}?sekme=gunluk&from=${weekAgo}`, icon: <ScrollText />, hint: "denetim günlüğü" },
  ];

  const tabs: PageTab[] = [
    { id: "kapsamlar", label: "Kullanıcı kapsamları", icon: Users },
    { id: "istisnalar", label: "Kapsam istisnaları", icon: ShieldCheck },
    { id: "izinler", label: "İzin istisnaları", icon: Fingerprint },
    { id: "gunluk", label: "Denetim günlüğü", icon: ScrollText },
  ];

  const todayKey = trDayKey();
  const minExpiry = trDayKey(daysFromNowIso(1));
  const quick30 = trDayKey(daysFromNowIso(30));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Ayarlara dön
        </Link>
      </div>
      <PageHeader
        title="Yetkilendirme"
        eyebrow="Rol & izin yönetimi"
        icon={<ICONS.yetkilendirme className="h-6 w-6" />}
        description={
          <>
            Kim hangi kayıtları görür (kapsam), hangi kayıt için geçici istisna var, kişiye özel izinler ve tüm değişikliklerin günlüğü.
            Rol bazlı izin matrisi için <Link href="/app/ayarlar/roller" className="font-semibold text-brand-600 hover:underline">İzin matrisi</Link>.
          </>
        }
      />
      {scopeSchemaMissing ? (
        <Alert tone="warning" title="Kapsam şeması bu ortamda henüz uygulanmadı">
          Kullanıcı kapsamları, kapsam istisnaları ve denetim günlüğü migration 20261006000100-104 uygulandıktan sonra açılır. Kişi bazlı izin istisnaları çalışır.
        </Alert>
      ) : null}
      <StatRow items={stats} label="Yetkilendirme özeti" />
      <PageTabs base={PATH} label="Yetkilendirme sekmeleri" tabs={tabs} active={active} />

      {active === "kapsamlar" ? (
        <>
          <ScopeEnforcementToggle settingKey={SCOPE_ENFORCEMENT_KEY} enabled={Boolean(enforcement)} canEdit={canEdit && !scopeSchemaMissing} />
          {!enforcement && !scopeSchemaMissing ? (
            <Alert tone="info">
              Kapsam uygulaması kapalı: tanımlar saklanır ama listeler bugünkü rol kuralıyla (yönetici ofis geneli, danışman kendi kayıtları) çalışır. Açınca aşağıdaki kapsamlar listelere yansır.
            </Alert>
          ) : null}
          <ScopeTable members={members} teams={teams} branches={branches} self={{ userId: ctx.userId, role: ctx.role }} canEdit={canEdit && !scopeSchemaMissing} />
        </>
      ) : null}

      {active === "istisnalar" ? (
        <OverrideManager
          members={profiles.map<OverrideMember>((p) => ({
            id: p.id,
            name: p.full_name,
            roleLabel: ROLE_LABELS[p.role] ?? p.role,
            disabled: p.role === "owner" || p.id === ctx.userId,
            disabledReason: p.role === "owner" ? "ofis sahibi her şeyi görür" : p.id === ctx.userId ? "kendinize istisna yazamazsınız" : undefined,
          }))}
          rows={await resolveOverrideRows(supabase, overrideRows, nameOf, nowMs)}
          initialUserId={profiles.some((p) => p.id === sp.user) ? (sp.user as string) : null}
          canEdit={canEdit && !scopeSchemaMissing}
          defaultExpiryDate={quick30}
          minExpiryDate={minExpiry}
        />
      ) : null}

      {active === "izinler" ? (
        <PermissionExceptions ctx={ctx} profiles={profiles} requestedUser={sp.user} canEdit={canEdit} todayKey={todayKey} minExpiry={minExpiry} quick30={quick30} />
      ) : null}

      {active === "gunluk" ? (
        <AuditLog sp={sp} nameOf={nameOf} />
      ) : null}
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** İstisna satırlarındaki kaynak adları (tür başına tek toplu sorgu; FK adıyla gömme). */
async function resolveOverrideRows(supabase: Supabase, rows: OverrideDbRow[], nameOf: Map<string, string>, nowMs: number): Promise<OverrideListRow[]> {
  const idsOf = (t: ScopeOverride["resource_type"]) => rows.filter((r) => r.resource_type === t).map((r) => r.resource_id);
  const labels = new Map<string, string>();
  const demandIds = idsOf("demand");
  const propertyIds = [...idsOf("property"), ...idsOf("portfolio")];
  const dealIds = idsOf("deal");
  const commissionIds = idsOf("commission");
  const [demands, properties, deals, commissions] = await Promise.all([
    demandIds.length ? supabase.from("customer_demands").select("id, transaction_type, property_type, customer:customers!customer_demands_customer_id_fkey(full_name)").in("id", demandIds) : Promise.resolve({ data: [] }),
    propertyIds.length ? supabase.from("properties").select("id, property_code, title").in("id", propertyIds) : Promise.resolve({ data: [] }),
    dealIds.length ? supabase.from("deals").select("id, stage, customer:customers!deals_customer_id_fkey(full_name)").in("id", dealIds) : Promise.resolve({ data: [] }),
    commissionIds.length ? supabase.from("commissions").select("id, status, deal:deals!commissions_deal_id_fkey(customer:customers!deals_customer_id_fkey(full_name))").in("id", commissionIds) : Promise.resolve({ data: [] }),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  for (const d of (demands.data ?? []) as { id: string; transaction_type: string; property_type: string | null; customer: unknown }[]) {
    const c = one(d.customer as { full_name?: string } | { full_name?: string }[] | null);
    labels.set(`demand:${d.id}`, `${c?.full_name ?? "Talep"} · ${d.transaction_type}${d.property_type ? ` · ${d.property_type}` : ""}`);
  }
  for (const p of (properties.data ?? []) as { id: string; property_code: string; title: string | null }[]) {
    labels.set(`property:${p.id}`, p.title ? `${p.title} (${p.property_code})` : p.property_code);
    labels.set(`portfolio:${p.id}`, p.title ? `${p.title} (${p.property_code})` : p.property_code);
  }
  for (const d of (deals.data ?? []) as { id: string; stage: string; customer: unknown }[]) {
    const c = one(d.customer as { full_name?: string } | { full_name?: string }[] | null);
    labels.set(`deal:${d.id}`, `${c?.full_name ?? "Anlaşma"} · ${d.stage}`);
  }
  for (const c of (commissions.data ?? []) as { id: string; status: string; deal: unknown }[]) {
    const deal = one(c.deal as { customer?: unknown } | { customer?: unknown }[] | null);
    const cust = one((deal?.customer ?? null) as { full_name?: string } | { full_name?: string }[] | null);
    labels.set(`commission:${c.id}`, `${cust?.full_name ?? "Komisyon"} · ${c.status}`);
  }
  return rows.map((r) => {
    const base = RESOURCE_HREF[r.resource_type];
    return {
      id: r.id,
      userId: r.user_id,
      userName: nameOf.get(r.user_id) ?? r.user_id.slice(0, 8),
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      resourceLabel: labels.get(`${r.resource_type}:${r.resource_id}`) ?? `${OVERRIDE_RESOURCE_LABELS[r.resource_type]} ${r.resource_id.slice(0, 8)}… (kayıt bulunamadı)`,
      resourceHref: base ? (r.resource_type === "commission" ? base : `${base}/${r.resource_id}`) : null,
      allowed: r.allowed,
      reason: r.reason,
      expiresAt: r.expires_at,
      createdByName: nameOf.get(r.created_by) ?? "—",
      createdAt: r.created_at,
      expired: isOverrideExpired(r.expires_at, nowMs),
    };
  });
}

/** (c) Kişi bazlı izin istisnaları — roller ekranından buraya taşındı (tek ekran; eski adres yönlendirir). */
async function PermissionExceptions({
  ctx,
  profiles,
  requestedUser,
  canEdit,
  todayKey,
  minExpiry,
  quick30,
}: {
  ctx: { userId: string; tenantId: string | null; role: string };
  profiles: ProfileRow[];
  requestedUser: string | undefined;
  canEdit: boolean;
  todayKey: string;
  minExpiry: string;
  quick30: string;
}) {
  const supabase = await createClient();
  const members: ExceptionMember[] = profiles.map((m) => ({ id: m.id, full_name: m.full_name, role: m.role, roleLabel: ROLE_LABELS[m.role] ?? m.role }));
  const selected = members.find((m) => m.id === (requestedUser ?? "").trim() && m.role !== "owner" && m.id !== ctx.userId) ?? null;
  let overrides: OverrideRow[] = [];
  let roleEffective: Awaited<ReturnType<typeof getEffectivePermissions>> = {};
  if (selected && ctx.tenantId) {
    const [{ data }, eff] = await Promise.all([
      supabase.from("user_permission_overrides").select("module, actions, expires_at").eq("tenant_id", ctx.tenantId).eq("user_id", selected.id),
      // Rol katmanlı etkin izin (kullanıcı istisnası HARİÇ) — soluk taban.
      getEffectivePermissions(ctx.tenantId, selected.role),
    ]);
    overrides = (data ?? []) as OverrideRow[];
    roleEffective = eff;
  }
  return (
    <UserExceptions
      key={selected?.id ?? "none"}
      members={members}
      selectedUserId={selected?.id ?? null}
      selfId={ctx.userId}
      roleEffective={roleEffective}
      overrides={overrides}
      modules={MODULES}
      moduleLabels={MODULE_LABELS}
      readOnly={!canEdit}
      todayKey={todayKey}
      minExpiry={minExpiry}
      quick30Date={quick30}
    />
  );
}

/** (d) Denetim günlüğü: URL filtre kontratı + gerçek sayfalama. */
async function AuditLog({
  sp,
  nameOf,
}: {
  sp: { kullanici?: string; yapan?: string; tur?: string; from?: string; to?: string; sayfa?: string };
  nameOf: Map<string, string>;
}) {
  const filters = normalizeAccessAuditFilters(sp);
  const page = parsePage(sp.sayfa);
  const result = await listAccessAudit(filters, page, AUDIT_PAGE_SIZE);
  const win = pageWindow(page, result.total, AUDIT_PAGE_SIZE, result.rows.length);
  const params = Object.fromEntries(accessAuditFiltersToParams(filters).entries());
  const hasFilter = hasAccessAuditFilter(filters);
  const people = [...nameOf.entries()].sort((a, b) => a[1].localeCompare(b[1], "tr"));
  const personOptions = [{ value: "", label: "Tümü" }, ...people.map(([id, name]) => ({ value: id, label: name }))];

  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display font-bold text-ink-950">Denetim günlüğü</h2>
          <p className="text-xs text-text-muted">Yalnız yetki DEĞİŞİKLİKLERİ yazılır (kim, kime, ne, önce/sonra, gerekçe). Okuma izi tutulmaz.</p>
        </div>
      </div>
      <form method="get" action={PATH} className="border-b border-line bg-canvas/50 px-5 py-3">
        <input type="hidden" name="sekme" value="gunluk" />
        <FilterGrid>
          <FilterSelect name="kullanici" label="Yetkisi değişen" value={filters.kullanici} options={personOptions} />
          <FilterSelect name="yapan" label="Değişikliği yapan" value={filters.yapan} options={personOptions} />
          <FilterSelect name="tur" label="İşlem" value={filters.tur} options={[{ value: "", label: "Tüm işlemler" }, ...Object.entries(AUDIT_CHANGE_LABELS).map(([value, label]) => ({ value, label }))]} />
          <div className="grid grid-cols-2 gap-2">
            <FilterDate name="from" label="Başlangıç" value={filters.from} />
            <FilterDate name="to" label="Bitiş" value={filters.to} />
          </div>
        </FilterGrid>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">Filtrele</button>
          {hasFilter ? <Link href={`${PATH}?sekme=gunluk`} className="text-xs font-semibold text-text-muted underline-offset-2 hover:text-danger-500 hover:underline">Temizle</Link> : null}
        </div>
      </form>
      {result.schemaMissing ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">Denetim günlüğü tablosu bu ortamda henüz yok (migration 20261006000102/000104).</div>
      ) : result.error ? (
        <div className="px-5 py-10 text-center text-sm text-danger-500" role="alert">{result.error}</div>
      ) : result.rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">
          {hasFilter ? "Filtreye uyan kayıt yok." : "Henüz yetki değişikliği kaydı yok. İlk kapsam/istisna değişikliği burada görünecek."}
        </div>
      ) : (
        <div className="divide-y divide-line">
          {result.rows.map((r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            const resType = d.resource_type as ScopeOverride["resource_type"] | undefined;
            const resId = typeof d.resource_id === "string" ? d.resource_id : null;
            const base = resType ? RESOURCE_HREF[resType] : null;
            const resourceHref = base && resId ? (resType === "commission" ? base : `${base}/${resId}`) : null;
            const resourceText = resType ? `${OVERRIDE_RESOURCE_LABELS[resType] ?? resType} · ${resId?.slice(0, 8) ?? ""}…` : d.module ? `Modül: ${d.module === "*" ? "tümü" : (MODULE_LABELS[d.module as AppModule] ?? String(d.module))}` : null;
            return (
              <article key={r.id} className="grid gap-2 px-5 py-3.5 md:grid-cols-[1.2fr_1fr_1.4fr_auto] md:items-start">
                <div>
                  <p className="text-sm font-semibold text-ink-950">{AUDIT_CHANGE_LABELS[r.change_type] ?? r.change_type}</p>
                  <p className="text-xs text-text-muted">
                    <Link href={`${PATH}?sekme=gunluk&yapan=${r.created_by}`} className="font-semibold hover:text-brand-600 hover:underline">{nameOf.get(r.created_by) ?? r.created_by.slice(0, 8)}</Link>
                    {" → "}
                    <Link href={`${PATH}?sekme=gunluk&kullanici=${r.user_id}`} className="font-semibold hover:text-brand-600 hover:underline">{nameOf.get(r.user_id) ?? r.user_id.slice(0, 8)}</Link>
                  </p>
                </div>
                <div className="text-xs text-text-muted">
                  {resourceText ? (
                    resourceHref ? (
                      <Link href={resourceHref} className="focus-ring group inline-flex items-center gap-1 hover:text-brand-600">
                        {resourceText} <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <span>{resourceText}</span>
                    )
                  ) : (
                    <span>Kapsam</span>
                  )}
                  {r.reason ? <p className="mt-0.5 italic">“{r.reason}”</p> : null}
                </div>
                <details className="min-w-0 text-xs text-text-muted">
                  <summary className="cursor-pointer list-none hover:text-brand-600">Önce / sonra</summary>
                  <div className="mt-2 grid gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-2.5 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 font-bold uppercase tracking-[0.06em] text-text-faint">Önce</p>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{d.before ? JSON.stringify(d.before, null, 2) : "—"}</pre>
                    </div>
                    <div>
                      <p className="mb-1 font-bold uppercase tracking-[0.06em] text-text-faint">Sonra</p>
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{d.after ? JSON.stringify(d.after, null, 2) : "—"}</pre>
                    </div>
                  </div>
                </details>
                <time className="text-xs font-semibold text-text-muted tabular-nums" dateTime={r.created_at}>{formatDateTimeTr(r.created_at)}</time>
              </article>
            );
          })}
        </div>
      )}
      {result.total > 0 ? (
        <div className="border-t border-line px-5 py-3">
          <ListPager pathname={PATH} params={params} window={win} total={result.total} />
        </div>
      ) : null}
    </section>
  );
}
