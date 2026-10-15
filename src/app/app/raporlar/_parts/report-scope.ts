import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { trDayKey } from "@/lib/clock";
import {
  resolveReportPeriod,
  resolveReportScope,
  type PeriodPreset,
  type ReportPeriod,
  type ReportScope,
} from "@/lib/report-center/period-scope";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ScopeOption = { id: string; name: string; branchId?: string | null; teamId?: string | null };

export type ReportScopeContext = {
  period: ReportPeriod;
  scope: ReportScope;
  /** Seçici gösterilsin mi (yönetim kademesi). */
  canPick: boolean;
  /** Takım lideri kendi takımına kilitli (şube/takım seçici gizli). */
  lockedTeam: { id: string; name: string } | null;
  branches: ScopeOption[];
  teams: ScopeOption[];
  advisors: ScopeOption[];
  /** "Kadıköy şubesi · Satış A takımı" — kapsam yoksa null. */
  scopeLabel: string | null;
};

/**
 * Dönem + kapsam çözümü (Raporlar genel bakış, Satış hunisi, Satış hızı). Kural:
 *  - owner/gm/branch_manager: şube, takım, danışman serbest seçilir.
 *  - team_lead: kendi takımına KİLİTLİ (URL'deki şube/takım yok sayılır); takım içinden danışman seçebilir.
 *  - diğer roller: seçici yok; kayıt kapsamı RLS'te (SK10) uygulanır.
 * Seçenek listeleri RLS'li oturumla okunur (yalnız kendi ofisi). Hepsi tek turda.
 */
export async function loadReportScopeContext(
  supabase: Supabase,
  input: {
    sp: Record<string, string | string[] | undefined>;
    role: string;
    userId: string;
    tenantId: string | null;
    nowMs: number;
    defaultPeriod?: PeriodPreset;
  },
): Promise<ReportScopeContext> {
  const period = resolveReportPeriod(input.sp, trDayKey(input.nowMs), input.defaultPeriod);
  const officeWide = hasOfficeWideDataScope(input.role);
  const teamLead = input.role === "team_lead";
  if (!input.tenantId || (!officeWide && !teamLead)) {
    return { period, scope: { branchId: null, teamId: null, profileId: null }, canPick: false, lockedTeam: null, branches: [], teams: [], advisors: [], scopeLabel: null };
  }
  const tenantId = input.tenantId;
  const [branchRes, teamRes, advisorRes, meRes] = await Promise.all([
    officeWide
      ? supabase.from("branches").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(100)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from("teams").select("id, name, branch_id").eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(200),
    supabase.from("profiles").select("id, full_name, branch_id, team_id").eq("tenant_id", tenantId).eq("is_active", true).order("full_name").limit(500),
    teamLead
      ? supabase.from("profiles").select("team_id").eq("id", input.userId).maybeSingle()
      : Promise.resolve({ data: null as { team_id: string | null } | null }),
  ]);
  const branches: ScopeOption[] = ((branchRes.data ?? []) as { id: string; name: string }[]).map((b) => ({ id: String(b.id), name: String(b.name ?? "") }));
  const teamsAll: ScopeOption[] = ((teamRes.data ?? []) as { id: string; name: string; branch_id: string | null }[]).map((t) => ({
    id: String(t.id),
    name: String(t.name ?? ""),
    branchId: t.branch_id ?? null,
  }));
  const advisorsAll: ScopeOption[] = ((advisorRes.data ?? []) as { id: string; full_name: string | null; branch_id: string | null; team_id: string | null }[]).map((p) => ({
    id: String(p.id),
    name: String(p.full_name ?? "—"),
    branchId: p.branch_id ?? null,
    teamId: p.team_id ?? null,
  }));

  const raw = resolveReportScope(input.sp);
  let lockedTeam: ReportScopeContext["lockedTeam"] = null;
  let scope: ReportScope;
  if (teamLead) {
    const myTeam = (meRes.data as { team_id?: string | null } | null)?.team_id ?? null;
    const team = myTeam ? teamsAll.find((t) => t.id === myTeam) : undefined;
    if (!team) {
      // Takımı olmayan takım lideri: seçici yok, RLS kapsamı geçerli.
      return { period, scope: { branchId: null, teamId: null, profileId: null }, canPick: false, lockedTeam: null, branches: [], teams: [], advisors: [], scopeLabel: null };
    }
    lockedTeam = { id: team.id, name: team.name };
    const member = raw.profileId && advisorsAll.some((a) => a.id === raw.profileId && a.teamId === team.id) ? raw.profileId : null;
    scope = { branchId: null, teamId: team.id, profileId: member };
  } else {
    scope = {
      branchId: raw.branchId && branches.some((b) => b.id === raw.branchId) ? raw.branchId : null,
      teamId: raw.teamId && teamsAll.some((t) => t.id === raw.teamId) ? raw.teamId : null,
      profileId: raw.profileId && advisorsAll.some((a) => a.id === raw.profileId) ? raw.profileId : null,
    };
  }

  const teams = lockedTeam ? teamsAll.filter((t) => t.id === lockedTeam.id) : teamsAll;
  const advisors = lockedTeam ? advisorsAll.filter((a) => a.teamId === lockedTeam.id) : advisorsAll;
  const parts: string[] = [];
  const bName = scope.branchId ? branches.find((b) => b.id === scope.branchId)?.name : null;
  const tName = scope.teamId ? teams.find((t) => t.id === scope.teamId)?.name : null;
  const aName = scope.profileId ? advisors.find((a) => a.id === scope.profileId)?.name : null;
  if (bName) parts.push(`${bName} şubesi`);
  if (tName) parts.push(`${tName} takımı`);
  if (aName) parts.push(aName);
  return {
    period,
    scope,
    canPick: true,
    lockedTeam,
    branches,
    teams,
    advisors,
    scopeLabel: parts.length > 0 ? parts.join(" · ") : null,
  };
}
