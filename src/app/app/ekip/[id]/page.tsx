import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, ArrowLeft, ArrowUpRight, CalendarDays, Gauge, GitBranch, LayoutDashboard, Phone, Sparkles, Target, Wallet } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { formatTurkishPhone } from "@/lib/phone";
import { now } from "@/lib/clock";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { canSeeEarningsOf } from "@/lib/team/earnings-scope";
import { summarizeAdvisorEarning } from "@/lib/team/advisor-share";
import { monthRanges } from "@/lib/team/advisor-360";
import { trMonthContext } from "@/lib/team/scorecard";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
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

const ROLE_LABELS: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  readonly: "Salt okunur",
};

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

export default async function TeamMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perms, userId, role } = await requireModulePage("team", "/app/ekip");
  const canHandoff = (perms.team ?? []).includes("edit");
  const { id } = await params;
  // Kapsam: ofis geneli rol (sahip, GM, şube müdürü) herkesin profilini, diğerleri yalnız kendi profilini görür.
  if (id !== userId && !hasOfficeWideDataScope(role)) redirect(`/app/ekip/${userId}`);
  // Kazanç gizliliği: başkasının kazancı yalnız `earnings_all` izniyle görünür.
  const showEarnings = canSeeEarningsOf(perms, userId, id);
  const supabase = await createClient();
  const sp = (await searchParams) ?? {};

  const { data: member } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, branch:branches!profiles_branch_id_fkey(name)")
    .eq("id", id)
    .maybeSingle();
  if (!member) notFound();

  const nowMs = now();
  const ranges = monthRanges(nowMs);
  const year = trMonthContext(nowMs).monthKey.slice(0, 4);

  // Komisyon satırları yalnız kazancı görme hakkı varsa çekilir (başkasının kazancı sunucudan bile çıkmaz).
  let commissions: CommissionRow[] = [];
  if (showEarnings) {
    const { data } = await supabase
      .from("commissions")
      .select("gross_amount, status, splits, created_at, deal:deals!commissions_deal_id_fkey(assigned_to)")
      .gte("created_at", `${year}-01-01T00:00:00+03:00`)
      .limit(2000);
    commissions = (data ?? []) as unknown as CommissionRow[];
  }
  const monthCollected = showEarnings
    ? summarizeAdvisorEarning(
        commissions.filter((c) => Date.parse(c.created_at) >= Date.parse(ranges.thisStartIso)),
        member.full_name,
        id,
      ).collected
    : 0;

  const tabs: DetailTabDef[] = [
    { id: "ozet", label: "Özet", icon: LayoutDashboard },
    { id: "aktivite", label: "Aktivite", icon: Activity },
    { id: "oncul", label: "Öncül göstergeler", icon: Gauge },
    { id: "pipeline", label: "Pipeline", icon: GitBranch },
    { id: "hedef", label: "Hedef", icon: Target, hidden: !effectiveCanAccessModule(perms, "targets") },
    { id: "kazanc", label: "Kazanç", icon: Wallet, hidden: !showEarnings },
    { id: "kosluk", label: "Koçluk", icon: Sparkles },
  ];
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.id);
  const active = resolveTab(sp, visible, "ozet");

  const ctx: Ctx = { supabase, id, fullName: member.full_name, showEarnings, isSelf: id === userId, commissions };
  const branch = relName(member.branch);

  return (
    <div className="space-y-6">
      <Link href="/app/ekip" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ekip
      </Link>

      <PageHeader
        className="mb-0"
        icon={
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius-panel)] bg-[image:var(--grad-brand)] font-display text-xl font-extrabold text-white shadow-[var(--shadow-glow-brand)]">
            {initials(member.full_name)}
          </span>
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
            <Link
              href={id === userId ? "/app/cuzdan" : "/app/ekip/kazanc"}
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-surface px-5 py-3 text-center shadow-[var(--shadow-xs)] hover:border-brand-300"
            >
              <p className="flex items-center justify-center gap-1.5 text-xs text-text-muted"><Wallet className="h-3.5 w-3.5" /> Bu ay tahsil edilen pay</p>
              <p className="mt-1 flex items-center justify-center gap-1 font-display text-xl font-extrabold text-mint-700">
                {money(monthCollected)}
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
            </Link>
          )
        }
      />

      <DetailTabs basePath={`/app/ekip/${id}`} tabs={tabs} active={active} label="Danışman 360 sekmeleri" />

      {active === "ozet" ? <OverviewTab ctx={ctx} canHandoff={canHandoff} /> : null}
      {active === "aktivite" ? <ActivityTab ctx={ctx} /> : null}
      {active === "oncul" ? <LeadTab ctx={ctx} /> : null}
      {active === "pipeline" ? <PipelineTab ctx={ctx} /> : null}
      {active === "hedef" ? <TargetTab ctx={ctx} /> : null}
      {active === "kazanc" ? <EarningsTab ctx={ctx} year={year} /> : null}
      {active === "kosluk" ? <CoachTab ctx={ctx} /> : null}
    </div>
  );
}
