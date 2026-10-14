import { platformCanAccess } from "@/lib/platform-access";
import { ButtonLink } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  History,
  KeyRound,
  LayoutList,
  Mail,
  Megaphone,
  Pencil,
  Phone,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { formatDateTimeTr } from "@/lib/format";
import { PageTabs } from "@/components/app/page-tabs";
import { MemberAccessPanel, MemberInfoForm } from "./member-forms";
import { TwoFactorResetPanel } from "./member-support-tools";
import { AccessInspector } from "./access-inspector";
import { explainModuleAccess, explainScope, type ScopeRowInput } from "@/lib/admin/member-access-explain";
import type { RoleOverrideRow, UserOverrideRow } from "@/lib/permissions-effective";
import { now } from "@/lib/clock";
import { ROLE_LABELS } from "@/lib/role-labels";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

const roleLabel: Record<string, string> = ROLE_LABELS; // tek kaynak: lib/role-labels.ts

type Rel = { name?: string } | { name?: string }[] | null;

function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : (value.name ?? null);
}

type LoginRow = { id?: string; created_at?: string; result?: string; ip?: string | null; user_agent?: string | null };

const LOGIN_RESULT_LABEL: Record<string, { label: string; ok: boolean }> = {
  success: { label: "Başarılı giriş", ok: true },
  failed: { label: "Başarısız deneme", ok: false },
  "2fa_pending": { label: "2FA doğrulaması bekledi", ok: false },
  "2fa_failed": { label: "2FA doğrulaması başarısız", ok: false },
};
type AuditRow = { id: string; action: string; entity_type: string | null; created_at: string };

function fmtDateTime(iso: string) {
  return formatDateTimeTr(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const MEMBER_TABS = [
  { id: "genel", label: "Genel", icon: LayoutList },
  { id: "bilgiler", label: "Bilgiler", icon: Pencil },
  { id: "erisim", label: "Erişim", icon: ShieldCheck },
  { id: "yetki", label: "Yetki", icon: SlidersHorizontal },
] as const;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Yetki sekmesi verisi (yalnız o sekmede okunur): ofis rol ayarı, kişi istisnaları, kapsam satırı, şube/takım
 * seçenekleri ve ofis durumu — altısı tek turda (Promise.all).
 */
async function loadAccessData(admin: Admin, profile: { id: string; tenant_id: string; role: string; team_id?: string | null; branch_id?: string | null }) {
  const [roleRes, userRes, scopeRes, branchesRes, teamsRes, tenantRes] = await Promise.all([
    admin.from("tenant_role_permissions").select("module, action, allowed").eq("tenant_id", profile.tenant_id).eq("role", profile.role),
    admin.from("user_permission_overrides").select("module, actions, expires_at").eq("tenant_id", profile.tenant_id).eq("user_id", profile.id),
    admin
      .from("user_scopes")
      .select("scope_type, team_id, branch_id, can_view_all_data, can_edit_team_members, can_override_permissions, can_see_earnings")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", profile.id)
      .maybeSingle(),
    admin.from("branches").select("id, name").eq("tenant_id", profile.tenant_id).eq("is_active", true).order("name", { ascending: true }).limit(100),
    admin.from("teams").select("id, name").eq("tenant_id", profile.tenant_id).eq("is_active", true).order("name", { ascending: true }).limit(100),
    admin.from("tenants").select("status").eq("id", profile.tenant_id).maybeSingle(),
  ]);
  const branches = (branchesRes.data ?? []) as { id: string; name: string }[];
  const teams = (teamsRes.data ?? []) as { id: string; name: string }[];
  const scopeRow = (scopeRes.data as ScopeRowInput | null) ?? null;
  const ctxTeam = teams.find((t) => t.id === (scopeRow?.team_id ?? profile.team_id))?.name ?? null;
  const ctxBranch = branches.find((b) => b.id === (scopeRow?.branch_id ?? profile.branch_id))?.name ?? null;
  const scope = explainScope(profile.role, scopeRow, { teamName: ctxTeam, branchName: ctxBranch });
  return {
    error: Boolean(roleRes.error || userRes.error),
    rows: explainModuleAccess({
      role: profile.role,
      roleOverrides: (roleRes.data ?? []) as RoleOverrideRow[],
      userOverrides: (userRes.data ?? []) as UserOverrideRow[],
      nowMs: now(),
    }),
    scope: { text: scope.text, custom: scope.custom, value: scope.scope },
    branches,
    teams,
    tenantStatus: (tenantRes.data as { status?: string } | null)?.status ?? null,
  };
}

export const metadata = { title: "Üye ayrıntısı" };

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ sekme?: string }>;
}) {
  const staff = await requirePlatformModule("members");
  const { id } = await params;
  const sekme = (await searchParams)?.sekme;
  const active = sekme === "bilgiler" || sekme === "erisim" || sekme === "yetki" ? sekme : "genel";
  const admin = createAdminClient();

  /*
   * login_events paralel bir migration ile geliyor — tablo yoksa sorgu hata döner,
   * `select("*")` + hata kontrolüyle bölüm sessizce "kayıt yok" gösterir.
   */
  const [{ data: profile }, authRes, loginRes, auditRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, phone, role, is_active, created_at, tenant_id, branch_id, team_id, two_factor_sms, tenant:tenants!profiles_tenant_id_fkey(name), branch:branches!profiles_branch_id_fkey(name)")
      .eq("id", id)
      .maybeSingle(),
    admin.auth.admin.getUserById(id).catch(() => ({ data: { user: null } })),
    // Tablo yoksa supabase throw etmez — hata `error` alanında döner, bölüm boş gösterilir.
    admin
      .from("login_events")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_logs")
      .select("id, action, entity_type, created_at")
      .eq("actor_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!profile) notFound();
  const accessData = active === "yetki" && profile.tenant_id ? await loadAccessData(admin, profile) : null;

  const authUser = authRes.data?.user ?? null;
  const logins = (loginRes.data ?? []) as LoginRow[];
  const loginsAvailable = !loginRes.error && loginRes.data !== null;
  const audits = (auditRes.data ?? []) as AuditRow[];

  const lastSuccess = logins.find((l) => l.result === "success" && l.created_at);
  const tenantName = relName(profile.tenant as Rel);
  const branchName = relName(profile.branch as Rel);

  const facts: { icon: typeof Mail; label: string; value: React.ReactNode }[] = [
    { icon: Mail, label: "E-posta", value: authUser?.email ?? "—" },
    { icon: Phone, label: "Telefon", value: profile.phone ? formatTurkishPhone(profile.phone) : "—" },
    { icon: CalendarDays, label: "Kayıt tarihi", value: fmtDateTime(profile.created_at) },
    {
      icon: KeyRound,
      label: "Son giriş",
      value: lastSuccess?.created_at
        ? relativeTimeTR(lastSuccess.created_at)
        : authUser?.last_sign_in_at
          ? relativeTimeTR(authUser.last_sign_in_at)
          : "Hiç giriş yapmadı",
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/members" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Üye listesi
      </Link>

      <AdminPageHeader
        eyebrow="Kullanıcı detayı"
        icon={UserRound}
        title={profile.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent-text">{roleLabel[profile.role] ?? profile.role}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${profile.is_active ? "bg-mint-500/15 text-mint-700" : "bg-ink-950/6 text-text-muted"}`}>
              {profile.is_active ? "Aktif" : "Pasif"}
            </span>
            {branchName ? <span>Şube: {branchName}</span> : null}
          </span>
        }
        actions={
          profile.tenant_id ? (
            <>
              {/* Tek kullanıcıya mesaj: Toplu duyuru formu bu ofis ve kullanıcıya ön dolu açılır. */}
              {platformCanAccess(staff, "broadcast") ? (
                <ButtonLink variant="outline" size="md" href={`/admin/duyuru?yeni=1&ofis=${profile.tenant_id}&uye=${id}`}>
                  <Megaphone className="h-4 w-4" aria-hidden /> Mesaj gönder
                </ButtonLink>
              ) : null}
              <ButtonLink variant="outline" size="md" href={`/admin/tenants/${profile.tenant_id}`}>
                <Building2 className="h-4 w-4" aria-hidden /> {tenantName ?? "Ofis"} <ArrowUpRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </>
          ) : null
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
              <dt className="flex items-center gap-1.5 text-xs text-text-muted">
                <f.icon className="h-3.5 w-3.5 text-accent-text" aria-hidden /> {f.label}
              </dt>
              <dd className="mt-1.5 truncate text-sm font-semibold text-ink-950">{f.value}</dd>
            </div>
          ))}
        </dl>
      </AdminPageHeader>

      <PageTabs base={`/admin/members/${id}`} label="Üye sekmeleri" tabs={MEMBER_TABS} active={active} />

      {active === "bilgiler" ? (
        <MemberInfoForm
          id={id}
          fullName={profile.full_name}
          phone={profile.phone}
          email={authUser?.email ?? null}
        />
      ) : null}

      {active === "erisim" ? (
        <div className="space-y-5">
          <MemberAccessPanel
            id={id}
            name={profile.full_name}
            role={profile.role}
            roleLabel={roleLabel[profile.role] ?? profile.role}
            isActive={profile.is_active}
            canRole={staff.role === "super_admin"}
            canActive={staff.role === "super_admin" || staff.role === "ops"}
            canReset={staff.role === "super_admin"}
          />
          <TwoFactorResetPanel id={id} enabled={Boolean(profile.two_factor_sms)} canReset={staff.role === "super_admin" || staff.role === "ops"} />
        </div>
      ) : null}

      {active === "yetki" && accessData && profile.tenant_id ? (
        accessData.error ? (
          <p role="alert" className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/8 px-4 py-6 text-center text-sm text-danger-600">
            İzin kayıtları okunamadı. Sayfayı yenileyin.
          </p>
        ) : (
          <AccessInspector
            memberId={id}
            tenantId={profile.tenant_id}
            role={profile.role}
            roleLabel={roleLabel[profile.role] ?? profile.role}
            isActive={profile.is_active}
            tenantStatus={accessData.tenantStatus}
            rows={accessData.rows}
            scope={accessData.scope}
            branches={accessData.branches}
            teams={accessData.teams}
            canEdit={staff.role === "super_admin" || staff.role === "ops"}
          />
        )
      ) : null}

      {active === "genel" ? (
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Son girişler */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <KeyRound className="h-4 w-4 text-brand-600" /> Son girişler
          </h2>
          <p className="text-xs text-text-muted">En son 20 giriş denemesi</p>
          {!loginsAvailable ? (
            <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Giriş kayıtları henüz toplanmıyor.
            </p>
          ) : logins.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Hiç giriş kaydı yok — kullanıcı daveti henüz kabul etmemiş olabilir.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/60">
              {logins.map((l, i) => {
                const meta = LOGIN_RESULT_LABEL[l.result ?? ""] ?? { label: l.result ?? "—", ok: false };
                return (
                  <li key={l.id ?? i} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.ok ? "bg-mint-500" : "bg-danger-500"}`} />
                      <span className="text-sm text-ink-950">{meta.label}</span>
                      {l.ip ? <span className="truncate text-xs text-text-faint">{l.ip}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted" title={l.created_at ? fmtDateTime(l.created_at) : undefined}>
                      {l.created_at ? relativeTimeTR(l.created_at) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Son işlemler (audit) */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Son işlemler
          </h2>
          <p className="text-xs text-text-muted">Kullanıcının denetim kaydındaki son 20 hareketi</p>
          {audits.length === 0 ? (
            <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Denetim kaydı bulunamadı.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/60">
              {audits.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="truncate text-sm text-ink-950">{auditActionLabel(a.action)}</span>
                    {a.entity_type ? (
                      <span className="shrink-0 rounded-full bg-ink-950/6 px-2 py-0.5 text-xs font-semibold text-text-muted">
                        {a.entity_type}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted" title={fmtDateTime(a.created_at)}>
                    {relativeTimeTR(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      ) : null}
    </div>
  );
}
