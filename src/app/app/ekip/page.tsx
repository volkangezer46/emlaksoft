import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import {
  ArrowUpRight,
  Building2,
  CalendarRange,
  Fingerprint,
  IdCard,
  FileWarning,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModulePage } from "@/lib/require-module-page";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import { AddBranchPanel, AddBranchTrigger } from "./team-panels";
import { BranchCard } from "./branch-card";
import { relativeTimeTR } from "@/lib/admin-format";
import { now, trDayKey } from "@/lib/clock";
import { loadOfficeDocAlerts } from "@/lib/advisor/advisor-store";
import type { CSSProperties } from "react";

import { ListHero, ListPage } from "@/components/ui/list-page";
import { ButtonLink } from "@/components/ui/button";
import { DashboardGrid, DashCell, DashCard, SectionHeader, KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { ROLE_LABELS } from "@/lib/role-labels";
import { SeatLimitBanner } from "@/components/app/seat-limit-banner";
import { ReferralNudge } from "@/components/app/referral-nudge";
import { loadSeatUsageSummary } from "@/lib/billing/seat-purchase";
import { AdvisorTable } from "@/components/app/office-center/advisor-table";
import { loadOfficeAdvisors } from "@/lib/office-center/store";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";

export const metadata = { title: "Ekip Merkezi" };
const RING_C = 2 * Math.PI * 42;

type Rel = { name?: string } | { name?: string }[] | null;

type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  branch_id: string | null;
  branch: Rel;
  /** Yayındaki dijital kartvizit (/danisman/[slug]) — kapalıysa null/false. */
  public_slug: string | null;
  is_public: boolean | null;
};

const roleMeta: Record<string, { label: string; cls: string }> = {
  owner: { label: ROLE_LABELS.owner, cls: "bg-amber-400/15 text-amber-600" },
  gm: { label: ROLE_LABELS.gm, cls: "bg-brand-600/10 text-brand-600" },
  branch_manager: { label: ROLE_LABELS.branch_manager, cls: "bg-brand-600/10 text-brand-600" },
  team_lead: { label: ROLE_LABELS.team_lead, cls: "bg-cyan-400/12 text-cyan-600" },
  advisor: { label: ROLE_LABELS.advisor, cls: "bg-mint-500/12 text-mint-600" },
  call_center: { label: ROLE_LABELS.call_center, cls: "bg-cyan-400/12 text-cyan-600" },
  accounting: { label: ROLE_LABELS.accounting, cls: "bg-amber-400/15 text-amber-600" },
  readonly: { label: ROLE_LABELS.readonly, cls: "bg-ink-950/8 text-text-muted" },
};


function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

/** Pasife almada iş devralabilecek roller (Ofis Merkezi ile aynı). */
const ADVISOR_LIKE = ["owner", "gm", "branch_manager", "team_lead", "advisor"];


export default async function TeamPage() {
  const { perms, tenantId, role: viewerRole, userId } = await requireModulePage("team", "/app/ekip");
  const assignableRoles = assignableRolesFor(viewerRole);
  const canManage = (perms.team ?? []).includes("create");
  const supabase = await createClient();


  /*
   * Son giriş bilgisi — login_events'ten üye başına en son başarılı giriş.
   * Tablo henüz yoksa / şema farklıysa sorgu hata döner: loginDataAvailable=false
   * olur ve giriş rozetleri hiç gösterilmez (yanlış "hiç girmedi" iddiasındansa sessizlik).
   * Admin client: login_events RLS politikasından bağımsız, tenant_id ile daraltılmış okuma.
   * Ana veri sorgularıyla birlikte tek turda paralel çalışır (şelale yok).
   */
  const loginPromise: Promise<{ user_id: string | null; created_at: string }[] | null> = tenantId
    ? (async () => {
        try {
          const admin = createAdminClient();
          // PostgREST 1000 satır sınırı: "son giriş" eksik kalmasın diye sayfalı okunur.
          const { data, error } = await fetchAllRows<{ user_id: string | null; created_at: string }>((from, to) =>
            admin
              .from("login_events")
              .select("user_id, created_at")
              .eq("tenant_id", tenantId)
              .eq("result", "success")
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to),
          );
          return error ? null : ((data ?? []) as { user_id: string | null; created_at: string }[]);
        } catch (e) {
          console.error("ekip login_events", e);
          return null;
        }
      })()
    : Promise.resolve(null);

  const [
    membersRes,
    branchesRes,
    { data: provincesData },
    { data: advisorCounts },
    loginRows,
    docAlerts,
    seatSummary,
    advisorList,
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, is_active, created_at, branch_id, public_slug, is_public, branch:branches!profiles_branch_id_fkey(name)").order("created_at", { ascending: true }).limit(500),
    supabase.from("branches").select("id, name, is_active, province_id, province:geo_provinces(name)").order("created_at", { ascending: true }).limit(200),
    provinceOptionsResult(),
    // Danışman başına müşteri sayısı — aggregate (10.000 satır yerine ~N satır)
    tenantId
      ? supabase.rpc("customer_counts_by_advisor", { p_tenant_id: tenantId })
      : Promise.resolve({ data: [] as { assigned_to: string; cnt: number }[] }),
    loginPromise,
    // Belge bitiş uyarıları — yalnız ofis sahibi / genel müdür görür; şema yoksa kart gösterilmez.
    tenantId && (viewerRole === "owner" || viewerRole === "gm")
      ? loadOfficeDocAlerts(supabase, tenantId, trDayKey(now()))
      : Promise.resolve(null),
    // Koltuk doluluğu (%eşik / %100 uyarısı): paket + satın alınmış ek kullanıcı.
    tenantId
      ? supabase
          .from("tenants")
          .select("plan")
          .eq("id", tenantId)
          .maybeSingle()
          .then(({ data }) => loadSeatUsageSummary(supabase, tenantId, String(data?.plan ?? "office")))
      : Promise.resolve(null),
    // Danışman listesi: Ofis Merkezi > Danışmanlar ile TEK kaynak + TEK bileşen (AdvisorTable).
    tenantId ? loadOfficeAdvisors(supabase, tenantId, { userId, role: viewerRole, perms }, now()) : Promise.resolve(null),
  ]);

  assertQueryBatchSucceeded([membersRes, branchesRes], ["members", "branches"], "Ekip");
  const membersData = membersRes.data;
  const branchesData = branchesRes.data;
  const members = (membersData ?? []) as Member[];

  const lastLoginByUser = new Map<string, string>();
  const loginDataAvailable = loginRows !== null;
  if (loginRows) {
    for (const row of loginRows) {
      if (row.user_id && !lastLoginByUser.has(row.user_id)) lastLoginByUser.set(row.user_id, row.created_at);
    }
  }
  const branches = (branchesData ?? []) as { id: string; name: string; is_active: boolean; province_id: string | null; province: Rel }[];
  const provinces = provincesData ?? [];

  const assignedCount = new Map<string, number>();
  ((advisorCounts ?? []) as { assigned_to: string; cnt: number }[]).forEach((r) => {
    if (r.assigned_to) assignedCount.set(r.assigned_to, Number(r.cnt));
  });

  const activeCount = members.filter((m) => m.is_active).length;
  const advisorCount = members.filter((m) => ["advisor", "team_lead", "branch_manager"].includes(m.role)).length;
  const activeRate = members.length ? activeCount / members.length : 0;

  const roleOrder = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];
  const roleMix = roleOrder
    .map((r) => ({
      key: r,
      label: roleMeta[r]?.label ?? r,
      count: members.filter((m) => m.role === r).length,
      color:
        r === "owner" || r === "accounting"
          ? "var(--amber-400)"
          : r === "advisor" || r === "team_lead"
            ? "var(--mint-500)"
            : r === "readonly"
              ? "rgba(10,18,36,0.2)"
              : "var(--brand-500)",
    }))
    .filter((r) => r.count > 0);
  const maxRole = Math.max(1, ...roleMix.map((r) => r.count));

  const loadRows = members
    .filter((m) => m.is_active)
    .map((m) => ({ id: m.id, name: m.full_name, count: assignedCount.get(m.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxLoad = Math.max(1, ...loadRows.map((r) => r.count));

  const canOfficeCenter = effectiveCanAccessModule(perms, "office_center");
  const canOfficeCenterEdit = (perms.office_center ?? []).includes("edit");
  // Sayfaya özgü satır rozeti: son giriş / hiç girmedi (+ daveti yinele) ve yayındaki kartvizit.
  const memberExtras = new Map(
    members.map((m) => [
      m.id,
      <span key={m.id} className="mt-1 flex flex-wrap items-center gap-1.5">
        {m.is_public && m.public_slug ? (
          <a href={`/danisman/${m.public_slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-600 transition hover:bg-brand-600/20">
            <IdCard className="h-3 w-3" /> Kartvizit
          </a>
        ) : null}
        {loginDataAvailable ? (
          lastLoginByUser.has(m.id) ? (
            <span className="text-xs text-text-faint">Son giriş: {relativeTimeTR(lastLoginByUser.get(m.id)!)}</span>
          ) : (
            <>
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600">Hiç giriş yapmadı</span>
              {canManage && m.role !== "owner" ? (
                <Link href={`/app/ekip/${m.id}?sekme=bilgi`} className="rounded-[var(--radius-control)] border border-line px-2 py-0.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300">
                  Daveti yinele
                </Link>
              ) : null}
            </>
          )
        ) : null}
      </span>,
    ]),
  );

  // KPI'lar sayfa içi bölüm çapalarına iner (#uyeler / #subeler)
  const kpis = [
    { label: "Ekip üyesi", value: members.length, icon: Users, href: "#uyeler" },
    { label: "Aktif", value: activeCount, icon: ShieldCheck, href: "#uyeler" },
    { label: "Saha danışmanı", value: advisorCount, icon: UserRound, href: "#uyeler" },
    { label: "Şube", value: branches.length, icon: Building2, href: "#subeler" },
  ];

  // Belge uyarısı: süresi dolan + 30 gün içinde bitenler. Sayı her zaman filtreli hedefe gider
  // (dolmuş varsa onlara, yoksa yaklaşanlara; hiç yoksa belge takibi sayfasına).
  const docList = docAlerts && docAlerts.available ? docAlerts.data : null;
  const docExpired = docList ? docList.filter((a) => a.state === "expired").length : 0;
  const docTotal = docList ? docList.length : 0;
  const docHref =
    docExpired > 0
      ? "/app/ekip/belgeler?durum=suresi_doldu"
      : docTotal > 0
        ? "/app/ekip/belgeler?durum=30"
        : "/app/ekip/belgeler";
  const docHint =
    docExpired > 0
      ? `${docExpired} belgenin süresi dolmuş`
      : docTotal > 0
        ? "30 gün içinde bitecek belgeler var"
        : "Tüm yetki ve SPK belgeleri güncel";

  return (
    <ListPage>
      <ListHero
        eyebrow="Ekip & yetkiler"
        art="ekip"
        title="Çalışan yönetimi"
        description="Danışmanları davet edin, rol ve şube atayın; herkes yalnızca yetkili olduğu müşteri ve portföyleri görür."
        actions={
          <>
            <ButtonLink href="/app/ayarlar/roller" variant="secondary" size="sm" icon={Fingerprint}>
              İzin matrisi
            </ButtonLink>
            <ButtonLink href="/app/ekip/izinler" variant="secondary" size="sm" icon={CalendarRange}>
              Tatil ve izin takvimi
            </ButtonLink>
            <ButtonLink href="/app/ekip/kartvizitim" variant="secondary" size="sm" icon={IdCard}>
              Kartvizitim
            </ButtonLink>
            {canManage ? (
              <ButtonLink href="/app/ekip/yeni" icon={UserPlus}>
                Danışman ekle
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <SeatLimitBanner summary={seatSummary} />
      <ReferralNudge moment="team_grew" show={activeCount >= 3} />
<KpiGrid count={kpis.length}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} icon={k.icon} href={k.href} tone="brand" dim={k.value === 0} />
        ))}
      </KpiGrid>

      {docList ? (
        <div className="max-w-sm">
          <KpiTile
            label="Süresi dolan / yaklaşan belgeler"
            value={docTotal}
            icon={FileWarning}
            href={docHref}
            tone={docExpired > 0 ? "danger" : "brand"}
            attention={docExpired > 0}
            dim={docTotal === 0}
            hint={docHint}
          />
        </div>
      ) : null}

      <DashboardGrid>
        <DashCell span={{ md: 6, xl: loadRows.length > 0 ? 5 : 12 }}>
          <DashCard aria-labelledby="rol-karisimi">
            <SectionHeader as="h2" title={<span id="rol-karisimi">Rol karışımı</span>} icon={<ShieldCheck />} />
            <div className="flex items-center gap-5">
              <div className="relative grid h-28 w-28 shrink-0 place-items-center">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`Aktif üye oranı yüzde ${Math.round(activeRate * 100)}`}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-sunken)" strokeWidth="8" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="var(--success)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    className="ring-sweep"
                    style={{ "--circ": RING_C, "--dash": RING_C * (1 - activeRate) } as CSSProperties}
                  />
                </svg>
                <div className="absolute text-center">
                  <p className="num text-xl text-text">%{Math.round(activeRate * 100)}</p>
                  <p className="text-xs text-text-muted">aktif</p>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {roleMix.slice(0, 5).map((r, i) => (
                  <div key={r.key}>
                    <div className="mb-0.5 flex justify-between text-xs text-text-muted">
                      <span>{r.label}</span>
                      <span className="font-bold text-text">{r.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="bar-live h-full rounded-full"
                        style={{ width: `${(r.count / maxRole) * 100}%`, background: r.color, animationDelay: `${i * 0.08}s` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DashCard>
        </DashCell>
        <DashCell span={{ md: 6, xl: 7 }}>
          {loadRows.length > 0 ? (
          <DashCard aria-labelledby="is-yuku">
            <SectionHeader as="h2" title={<span id="is-yuku">Müşteri dağılımı</span>} eyebrow="İş yükü" />
            <div className="space-y-3">
              {loadRows.map((r, i) => (
                <Link key={r.id} href={`/app/ekip/${r.id}`} className="focus-ring group block rounded-[var(--radius-control)] p-1 -m-1">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="flex items-center gap-1 font-semibold text-ink-950 group-hover:text-brand-600">
                      {r.name}
                      <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                    </span>
                    <span className="tabular-nums text-text-muted">{r.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                      style={{ width: `${Math.max((r.count / maxLoad) * 100, 4)}%`, animationDelay: `${i * 0.07}s` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </DashCard>
          ) : null}
        </DashCell>
      </DashboardGrid>

      {!canManage ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-ink-950">
          <ShieldCheck className="h-5 w-5 text-amber-500" /> Ekibi yalnızca ofis sahibi ve yöneticiler düzenleyebilir. Görüntüleme modundasınız.
        </div>
      ) : null}

      

      {/* Ekip üyeleri: Ofis Merkezi > Danışmanlar ile aynı liste (AdvisorTable + loadOfficeAdvisors); burada yalnız son giriş/kartvizit rozeti ek. */}
      <section id="uyeler" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Ekip üyeleri</h2>
            <p className="text-xs text-text-muted">{members.length} kişi · {activeCount} aktif</p>
          </div>
          {canOfficeCenter ? (
            <Link href="/app/ofis-merkezi?sekme=danismanlar" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              Filtrele ve sırala <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {advisorList ? (
          <AdvisorTable
            rows={advisorList.rows}
            extra={memberExtras}
            actions={
              canManage && canOfficeCenterEdit
                ? {
                    viewerId: userId,
                    roles: assignableRoles,
                    branches: advisorList.branches,
                    teams: advisorList.teams,
                    teamsAvailable: advisorList.teamsAvailable,
                    handoffTargets: advisorList.rows.filter((r) => r.isActive && ADVISOR_LIKE.includes(r.role)).map((r) => ({ id: r.id, name: r.fullName })),
                  }
                : null
            }
          />
        ) : null}
      </section>

      {/* branches */}
      <section id="subeler" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Şubeler</h2>
          <div className="flex items-center gap-2">
            <Link href="/app/ekip/subeler" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              Şubeleri yönet <ArrowUpRight className="h-3 w-3" />
            </Link>
            {canManage ? <AddBranchTrigger /> : null}
          </div>
        </div>
        {canManage ? <AddBranchPanel provinces={provinces} /> : null}
        {branches.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">Henüz şube tanımlanmadı. Tek ofis olarak da çalışabilirsiniz.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => (
              <BranchCard
                key={b.id}
                branch={{ id: b.id, name: b.name, province_id: b.province_id }}
                memberCount={members.filter((m) => m.branch_id === b.id).length}
                provinceName={relName(b.province) ?? null}
                provinces={provinces}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </section>
    </ListPage>
  );
}
