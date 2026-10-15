import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { loadAvatarMap } from "@/lib/avatar-read";
import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, BadgeCheck, MapPinned, ArrowUpRight, CalendarDays, Gauge, GitBranch, LayoutDashboard, Phone, Sparkles, Target, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone } from "@/lib/phone";
import { now, trDayKey } from "@/lib/clock";
import { effectiveCanAccessModule, type EffectivePermissions } from "@/lib/permissions-effective";
import { handoffEditableScopes } from "@/lib/team/handoff";
import { canManageRole } from "@/lib/team/assignable-roles";
import { loadMemberAccess } from "@/lib/team/member-admin";
import { MemberInfoPanel } from "./member-info-panel";
import { Alert } from "@/components/ui/alert";
import { loadWorkProfile, probeAdvisorPrivateSchema, probeAdvisorSpecialtySchema } from "@/lib/advisor/advisor-store";
import { collectDocAlerts, DOC_KIND_LABEL } from "@/lib/advisor/advisor-profile";
import { ActivityExtra } from "./activity-extra";
import { ProfileTab, docFilterHref } from "./profil-tab";
import { SpecialtyTab } from "./uzmanlik-tab";
import { canSeeAllEarnings, canSeeEarningsOf } from "@/lib/team/earnings-scope";
import { fetchCommissionRows, trYearPeriod } from "@/lib/team/advisor-metrics";
import { trMonthContext } from "@/lib/team/scorecard";
import { DetailSegmentTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { loadMemberMonth, type MemberMonth } from "./advisor-data";
import { AdvisorListingOpsCard } from "@/components/listing-control/advisor-ops-card";
import { AdvisorSurveyCard } from "@/components/surveys/advisor-survey-card";
import {
  ActivityTab,
  CoachTab,
  EarningsTab,
  LeadTab,
  OverviewTab,
  PipelineTab,
  TargetTab,
  type CommissionRow,
  type Ctx,
} from "./tab-panels";
import { ROLE_LABELS } from "@/lib/role-labels";


function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-28" />
      <Skeleton className="h-56" />
    </div>
  );
}
async function MonthCollectedCard({ monthP, href }: { monthP: Promise<MemberMonth>; href: string }) {
  const month = await monthP;
  return (
    <Link
      href={href}
      className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-surface px-5 py-3 text-center shadow-[var(--shadow-xs)] hover:border-brand-300"
    >
      <p className="flex items-center justify-center gap-1.5 text-xs text-text-muted"><Wallet className="h-3.5 w-3.5" /> Bu ay tahsil edilen pay</p>
      <p className="mt-1 flex items-center justify-center gap-1 font-display text-xl font-extrabold text-mint-700">
        {money(month.revenue.cur ?? 0)}
        <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
      </p>
    </Link>
  );
}
function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function relName(v: unknown): string | null {
  if (!v) return null;
  const o = Array.isArray(v) ? v[0] : v;
  return (o as { name?: string } | null)?.name ?? null;
}
function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

/**
 * Danışman 360 gövdesi: `/app/ekip/[id]` (yönetici, herkes) ve `/app/performansim` (kişinin kendi karnesi)
 * AYNI bileşeni kullanır. Yetki ve kapsam kararı çağıran sayfadadır (gövde yalnız `memberId` için çizer).
 * Sayılar tek kaynaktan (loadAdvisorMetrics) gelir.
 */
export async function AdvisorDetailView({
  memberId,
  basePath,
  backHref,
  searchParams,
  auth,
  headingAs = "h1",
  personalView = false,
}: {
  memberId: string;
  /** Sekme bağlantılarının kökü. */
  basePath: string;
  /** Başlıktaki geri bağlantısı (Performansım'da yok). */
  backHref?: { href: string; label: string };
  searchParams: Record<string, string | string[] | undefined>;
  auth: { userId: string; role: string; tenantId: string | null; perms: EffectivePermissions };
  /** Performansım üstünde DashboardHero (tek h1) olduğu için orada "h2". */
  headingAs?: "h1" | "h2";
  /**
   * Danışmanın KENDİ görünümü (/app/performansim): "Kişisel bilgiler" (Hesabım'da) ve "Kazanç" (Komisyonum kartı ve
   * /app/cuzdan'da) sekmeleri gizlenir; yöneticinin danışman 360'ında (/app/ekip/[id]) kalır.
   */
  personalView?: boolean;
}) {
  const { perms, userId, role, tenantId } = auth;
  const id = memberId;
  const canHandoff = (perms.team ?? []).includes("edit") && id !== userId;
  // Kazanç gizliliği: başkasının kazancı yalnız `earnings_all` izniyle görünür.
  const showEarnings = canSeeEarningsOf(perms, userId, id);
  const supabase = await createClient();

  const nowMs = now();
  const year = trMonthContext(nowMs).monthKey.slice(0, 4);
  const yearPeriod = trYearPeriod(Number(year));
  const viewer = { userId, role, perms };

  // Tek tur: üye satırı, avatar, aylık sayılar + gelir, yıllık komisyon, çalışma profili ve şema yoklamaları birbirine
  // bağlı DEĞİL (eskiden 4 ardışık tur). Üye görünmüyorsa (RLS/yanlış id) notFound() hiçbir şey çizmeden keser.
  // Aylık sayılar + gelir: tek kaynak. Yıllık komisyon satırları yalnız kazancı görme hakkı varsa çekilir
  // (başkasının kazancı sunucudan bile çıkmaz; kapı fetchCommissionRows içindedir).
  // Aylık sayılar (10+ sorgu) künyeyi BEKLETMEZ: söz burada başlar, sekmeler ve ücret kartı kendi Suspense'inde bekler.
  const monthP = loadMemberMonth(supabase, { viewer, tenantId, id, nowMs });
  const [{ data: member }, avatarMap, commissionRes, workRes, specialtyReady, privateReady] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, title, role, is_active, created_at, branch:branches!profiles_branch_id_fkey(name)")
      .eq("id", id)
      .maybeSingle(),
    loadAvatarMap([id], supabase),
    showEarnings
      ? fetchCommissionRows<CommissionRow>(supabase, {
          tenantId,
          viewerId: userId,
          seeAll: canSeeAllEarnings(perms),
          startIso: yearPeriod.startIso,
          endIso: yearPeriod.endIso,
        })
      : Promise.resolve({ rows: [] as CommissionRow[], error: false, partial: false }),
    // Danışman profili (migration 20260816001300/001400) uygulanmamışsa ilgili sekmeler gizlenir (sıfır hata, mevcut sekmeler aynen).
    tenantId ? loadWorkProfile(supabase, tenantId, id) : Promise.resolve({ available: false as const, data: null }),
    tenantId ? probeAdvisorSpecialtySchema(supabase) : Promise.resolve(false),
    tenantId ? probeAdvisorPrivateSchema(supabase) : Promise.resolve(false),
  ]);
  if (!member) notFound();
  const memberAvatar = avatarMap.get(id);
  const commissions = commissionRes.rows;

  // P0-11: yönetici üyenin ad/telefon/unvanını düzeltir, erişim bağlantısı gönderir, pasifleştirir.
  const canEditInfo =
    (perms.team ?? []).includes("edit") &&
    id !== userId &&
    member.role !== "owner" &&
    canManageRole(role, member.role);

  const todayKey = trDayKey(nowMs);
  const work = workRes.available ? workRes.data : null;
  const isManager = role === "owner" || role === "gm";
  const profileTabVisible = workRes.available || privateReady;
  const docAlerts = work
    ? collectDocAlerts(
        [{ profile_id: id, authority_cert_expires_on: work.authority_cert_expires_on, spk_cert_expires_on: work.spk_cert_expires_on }],
        todayKey,
      )
    : [];

  const tabs: DetailTabDef[] = [
    { id: "ozet", label: "Özet", icon: LayoutDashboard },
    { id: "aktivite", label: "Aktivite", icon: Activity },
    { id: "oncul", label: "Erken işaretler", icon: Gauge },
    { id: "pipeline", label: "Satış hattı", icon: GitBranch },
    { id: "hedef", label: "Hedef", icon: Target, hidden: !effectiveCanAccessModule(perms, "targets") },
    { id: "kazanc", label: "Kazanç", icon: Wallet, hidden: !showEarnings || personalView },
    { id: "kosluk", label: "Gelişim önerileri", icon: Sparkles },
    // Aynı veriye üç ad (Kimlik ve kişisel / Profil ve belgeler / Bilgiler) TEK sekmede: "Kişisel bilgiler".
    { id: "profil", label: "Kişisel bilgiler", icon: BadgeCheck, hidden: personalView || ((!profileTabVisible || !tenantId) && !canEditInfo) },
    { id: "uzmanlik", label: "Uzmanlık ve bölgeler", icon: MapPinned, hidden: !specialtyReady || !tenantId },
  ];
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.id);
  const active = resolveTab(searchParams, visible, "ozet");

  const ctx: Ctx = {
    supabase,
    id,
    fullName: member.full_name,
    showEarnings,
    isSelf: id === userId,
    commissions,
    viewer,
    tenantId,
    monthP,
  };
  const branch = relName(member.branch);
  // Kişisel bilgiler sekmesi: erişim özeti + pasife alırken devralan seçimi için diğer aktif üyeler (paralel).
  const loadInfo = active === "profil" && canEditInfo && tenantId;
  const [access, handoffAdvisors] = loadInfo
    ? await Promise.all([
        loadMemberAccess(tenantId, id),
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .neq("id", id)
          .neq("role", "readonly")
          .order("full_name")
          .limit(500)
          .then((r) => (r.data ?? []) as { id: string; full_name: string }[]),
      ])
    : [null, [] as { id: string; full_name: string }[]];

  return (
    <div className="space-y-6">
      {backHref ? (
        <Link href={backHref.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> {backHref.label}
        </Link>
      ) : null}

      <PageHeader
        className="mb-0"
        as={headingAs}
        icon={
          memberAvatar?.avatar_url || memberAvatar?.avatar_preset ? (
            <Avatar name={member.full_name} src={memberAvatar.avatar_url} preset={memberAvatar.avatar_preset} className="h-16 w-16" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius-panel)] bg-[image:var(--grad-brand)] font-display text-xl font-extrabold text-white shadow-[var(--shadow-glow-brand)]">
              {initials(member.full_name)}
            </span>
          )
        }
        title={member.full_name}
        meta={
          <>
            <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{ROLE_LABELS[member.role] ?? member.role}</span>
            {!member.is_active ? <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-600">Pasif</span> : null}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {branch ? <span>{branch}</span> : null}
            {member.phone ? (
              <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
                <Phone className="h-3.5 w-3.5" /> {formatTurkishPhone(member.phone)}
              </a>
            ) : null}
            <Link href={`/app/randevular?danisman=${id}`} className="inline-flex items-center gap-1.5 hover:text-brand-600">
              <CalendarDays className="h-3.5 w-3.5" /> Randevular
            </Link>
          </span>
        }
        actions={
          !showEarnings ? undefined : (
            <Suspense fallback={<Skeleton className="h-[68px] w-44" />}>
              <MonthCollectedCard monthP={monthP} href={id === userId ? "/app/cuzdan" : "/app/cuzdan?sekme=ofis"} />
            </Suspense>
          )
        }
      />

      {isManager && docAlerts.length > 0 ? (
        <Alert
          tone={docAlerts.some((a) => a.state !== "month") ? "danger" : "warning"}
          title="Danışman belgesi için uyarı"
          action={
            <Link href={`${basePath}?sekme=profil`} className="focus-ring text-sm font-semibold underline">
              Belgeleri aç
            </Link>
          }
        >
          {docAlerts.map((a) => (
            <Link key={a.kind} href={docFilterHref(a.state === "month" ? "month" : a.state === "week" ? "week" : "expired", a.kind) ?? "/app/ekip/belgeler"} className="mr-3 inline-block font-semibold underline">
              {DOC_KIND_LABEL[a.kind]}: {a.state === "expired" ? "süresi doldu" : a.daysLeft === 0 ? "bugün bitiyor" : `${a.daysLeft} gün kaldı`}
            </Link>
          ))}
        </Alert>
      ) : null}

      <DetailSegmentTabs basePath={basePath} tabs={tabs} active={active} label="Danışman 360 sekmeleri" />

      {/* Sekme içerikleri kendi Suspense sınırında akar: künye + sekme şeridi sekme verisini BEKLEMEDEN boyanır. */}
      {active === "ozet" ? (
        <Suspense fallback={<TabSkeleton />}>
          <OverviewTab ctx={ctx} canHandoff={canHandoff} editableScopes={handoffEditableScopes(perms)} />
        </Suspense>
      ) : null}
      {active === "ozet" && effectiveCanAccessModule(perms, "portals") ? (
        <Suspense fallback={null}>
          <AdvisorListingOpsCard advisorId={id} />
        </Suspense>
      ) : null}
      {active === "ozet" && effectiveCanAccessModule(perms, "surveys") ? (
        <Suspense fallback={null}>
          <AdvisorSurveyCard advisorId={id} />
        </Suspense>
      ) : null}
      {active === "aktivite" ? (
        <Suspense fallback={<TabSkeleton />}>
          <ActivityTab ctx={ctx} />
          <ActivityExtra supabase={supabase} id={id} />
        </Suspense>
      ) : null}
      {active === "oncul" ? (
        <Suspense fallback={<TabSkeleton />}>
          <LeadTab ctx={ctx} />
        </Suspense>
      ) : null}
      {active === "pipeline" ? (
        <Suspense fallback={<TabSkeleton />}>
          <PipelineTab ctx={ctx} />
        </Suspense>
      ) : null}
      {active === "hedef" ? (
        <Suspense fallback={<TabSkeleton />}>
          <TargetTab ctx={ctx} />
        </Suspense>
      ) : null}
      {active === "kazanc" ? (
        <Suspense fallback={<TabSkeleton />}>
          <EarningsTab ctx={ctx} year={year} />
        </Suspense>
      ) : null}
      {active === "kosluk" ? (
        <Suspense fallback={<TabSkeleton />}>
          <CoachTab ctx={ctx} />
        </Suspense>
      ) : null}
      {active === "profil" && canEditInfo ? (
        <MemberInfoPanel
          memberId={id}
          fullName={member.full_name}
          phone={member.phone}
          title={member.title}
          isActive={member.is_active}
          email={access?.email ?? null}
          lastSignInAt={access?.lastSignInAt ?? null}
          neverSignedIn={access?.neverSignedIn ?? false}
          advisors={handoffAdvisors}
          editableScopes={handoffEditableScopes(perms)}
        />
      ) : null}
      {active === "profil" && tenantId && profileTabVisible ? (
        <Suspense fallback={<TabSkeleton />}>
        <ProfileTab
          supabase={supabase}
          tenantId={tenantId}
          memberId={id}
          viewerId={userId}
          viewerRole={role}
          work={work}
          workAvailable={workRes.available}
          todayKey={todayKey}
        />
        </Suspense>
      ) : null}
      {active === "uzmanlik" && tenantId ? (
        <Suspense fallback={<TabSkeleton />}>
          <SpecialtyTab supabase={supabase} tenantId={tenantId} memberId={id} viewerRole={role} />
        </Suspense>
      ) : null}
    </div>
  );
}
