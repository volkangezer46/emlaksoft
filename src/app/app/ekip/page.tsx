import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  CalendarRange,
  Crown,
  Fingerprint,
  IdCard,
  PalmtreeIcon,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModulePage } from "@/lib/require-module-page";
import { setMemberActive, setMemberRole } from "@/app/actions/team";
import { resendInvite } from "./invite-actions";
import { AddBranchPanel, AddBranchTrigger } from "./team-panels";
import { BranchCard } from "./branch-card";
import { formatTurkishPhone } from "@/lib/phone";
import { relativeTimeTR } from "@/lib/admin-format";
import { now } from "@/lib/clock";
import { TR_OFFSET_MIN } from "@/lib/booking-slots";
import { isOnLeave, type LeaveLike } from "@/lib/leave-utils";
import type { CSSProperties } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { DashboardGrid, DashCell, DashCard, SectionHeader, KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { ROLE_LABELS } from "@/lib/role-labels";

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

const assignableRoles = ["advisor", "team_lead", "branch_manager", "gm", "call_center", "accounting", "readonly"];

function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export default async function TeamPage() {
  const { perms, tenantId } = await requireModulePage("team", "/app/ekip");
  const canManage = (perms.team ?? []).includes("create");
  const supabase = await createClient();

  // Bugün izinli olanlar — listede küçük "İzinde" rozeti için (bkz. /app/ekip/izinler).
  // TR duvar günü: booking-slots ile aynı sabit ofset kararı (TR'de DST yok).
  const todayKey = new Date(now() + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

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
          const { data, error } = await admin
            .from("login_events")
            .select("user_id, created_at")
            .eq("tenant_id", tenantId)
            .eq("result", "success")
            .order("created_at", { ascending: false })
            .limit(2000);
          return error ? null : ((data ?? []) as { user_id: string | null; created_at: string }[]);
        } catch (e) {
          console.error("ekip login_events", e);
          return null;
        }
      })()
    : Promise.resolve(null);

  const [
    { data: membersData },
    { data: branchesData },
    { data: provincesData },
    { data: advisorCounts },
    { data: leaveRows },
    loginRows,
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, is_active, created_at, branch_id, public_slug, is_public, branch:branches!profiles_branch_id_fkey(name)").order("created_at", { ascending: true }).limit(500),
    supabase.from("branches").select("id, name, is_active, province_id, province:geo_provinces(name)").order("created_at", { ascending: true }).limit(200),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    // Danışman başına müşteri sayısı — aggregate (10.000 satır yerine ~N satır)
    tenantId
      ? supabase.rpc("customer_counts_by_advisor", { p_tenant_id: tenantId })
      : Promise.resolve({ data: [] as { assigned_to: string; cnt: number }[] }),
    supabase
      .from("staff_leaves")
      .select("staff_id, starts_on, ends_on, status")
      .eq("status", "onayli")
      .lte("starts_on", todayKey)
      .gte("ends_on", todayKey)
      .limit(200),
    loginPromise,
  ]);

  const members = (membersData ?? []) as Member[];
  const todayLeaves = (leaveRows ?? []) as LeaveLike[];

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

  // KPI'lar sayfa içi bölüm çapalarına iner (#uyeler / #subeler)
  const kpis = [
    { label: "Ekip üyesi", value: members.length, icon: Users, href: "#uyeler" },
    { label: "Aktif", value: activeCount, icon: ShieldCheck, href: "#uyeler" },
    { label: "Saha danışmanı", value: advisorCount, icon: UserRound, href: "#uyeler" },
    { label: "Şube", value: branches.length, icon: Building2, href: "#subeler" },
  ];

  return (
    <div className="space-y-6">
      {/* premium header */}
      <PageHeader title="Çalışan yönetimi" eyebrow="Ekip & yetkiler" description="Danışmanları davet edin, rol ve şube atayın; herkes yalnızca yetkili olduğu müşteri ve portföyleri görür." actions={
<div className="flex flex-wrap items-center gap-2">
                <Link href="/app/ayarlar/roller" className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-text transition hover:bg-surface-2">
                  <Fingerprint className="h-4 w-4" /> İzin matrisi
                </Link>
                <Link href="/app/ekip/izinler" className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-text transition hover:bg-surface-2"><CalendarRange className="h-4 w-4" /> Tatil ve izin takvimi</Link>
                <Link href="/app/ekip/kartvizitim" className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-text transition hover:bg-surface-2"><IdCard className="h-4 w-4" /> Kartvizitim</Link>
                {canManage ? (
                  <Link href="/app/ekip/yeni" className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90">
                    <UserPlus className="h-4 w-4" /> Danışman ekle
                  </Link>
                ) : null}
              </div>
} />
<KpiGrid count={kpis.length}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} icon={k.icon} href={k.href} tone="brand" dim={k.value === 0} />
        ))}
      </KpiGrid>

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

      

      {/* team list */}
      <section id="uyeler" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Ekip üyeleri</h2>
            <p className="text-xs text-text-muted">{members.length} kişi · {activeCount} aktif</p>
          </div>
        </div>

        <div className="divide-y divide-line">
          {members.map((m) => {
            const meta = roleMeta[m.role] ?? { label: m.role, cls: "bg-ink-950/8 text-text-muted" };
            const isOwner = m.role === "owner";
            const custCount = assignedCount.get(m.id) ?? 0;
            return (
              <article key={m.id} className={`grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.4fr_1fr_0.8fr_auto] lg:items-center ${!m.is_active ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                    {initials(m.full_name)}
                    {isOwner ? <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-amber-400 text-ink-950"><Crown className="h-2.5 w-2.5" /></span> : null}
                  </span>
                  <div className="min-w-0">
                    <Link href={`/app/ekip/${m.id}`} className="group inline-flex items-center gap-1 truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600">
                      <span className="truncate">{m.full_name}</span>
                      <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-text-muted">{m.phone ? formatTurkishPhone(m.phone) : "Telefon yok"}{relName(m.branch) ? ` · ${relName(m.branch)}` : ""}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                  {!m.is_active ? <span className="rounded-full bg-ink-950/8 px-2 py-0.5 text-xs font-semibold text-text-muted">Pasif</span> : null}
                  {m.is_public && m.public_slug ? (
                    <a
                      href={`/danisman/${m.public_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-600 transition hover:bg-brand-600/20"
                    >
                      <IdCard className="h-3 w-3" /> Kartvizit
                    </a>
                  ) : null}
                  {isOnLeave(todayLeaves, m.id, todayKey) ? (
                    <Link href="/app/ekip/izinler" className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600 transition hover:bg-amber-400/25">
                      <PalmtreeIcon className="h-3 w-3" /> İzinde
                    </Link>
                  ) : null}
                  {loginDataAvailable ? (
                    lastLoginByUser.has(m.id) ? (
                      <span className="text-xs text-text-faint">Son giriş: {relativeTimeTR(lastLoginByUser.get(m.id)!)}</span>
                    ) : (
                      <>
                        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600">Hiç giriş yapmadı</span>
                        {canManage && !isOwner ? (
                          <form action={resendInvite}>
                            <input type="hidden" name="id" value={m.id} />
                            <button
                              type="submit"
                              className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                            >
                              Daveti yinele
                            </button>
                          </form>
                        ) : null}
                      </>
                    )
                  ) : null}
                </div>

                <Link
                  href={`/app/musteriler?assigned=${m.id}`}
                  className="focus-ring rounded-[var(--radius-control)] text-xs text-text-muted transition hover:text-brand-600"
                  aria-label={`${m.full_name} müşterileri`}
                >
                  <span className="font-display text-base font-extrabold text-ink-950">{custCount}</span> müşteri
                </Link>

                <div className="flex items-center justify-end gap-2">
                  {canManage && !isOwner ? (
                    <>
                      <form action={setMemberRole} className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="id" value={m.id} />
                        <select name="role" defaultValue={m.role} className="rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                          {assignableRoles.map((r) => <option key={r} value={r}>{roleMeta[r].label}</option>)}
                        </select>
                        {branches.length > 0 ? (
                          <select name="branch_id" defaultValue={m.branch_id ?? ""} className="rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                            <option value="">Şubesiz</option>
                            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        ) : null}
                        <button type="submit" className="rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300">Uygula</button>
                      </form>
                      <form action={setMemberActive}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="is_active" value={(!m.is_active).toString()} />
                        <button type="submit" className={`rounded-[var(--radius-control)] border px-2.5 py-1.5 text-xs font-semibold transition ${m.is_active ? "border-line text-text-muted hover:border-danger-500/40 hover:text-danger-500" : "border-mint-500/30 text-mint-600 hover:bg-mint-500/8"}`}>
                          {m.is_active ? "Pasifleştir" : "Aktifleştir"}
                        </button>
                      </form>
                    </>
                  ) : (
                    <span className="text-xs text-text-faint">{isOwner ? "Ofis sahibi" : "—"}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* branches */}
      <section id="subeler" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Şubeler</h2>
          {canManage ? <AddBranchTrigger /> : null}
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
    </div>
  );
}
