/**
 * Rapor bağlamı kurucuları (SUNUCU). Kiracı raporları RLS'li kullanıcı istemcisiyle çalışır; platform raporları
 * (yalnız EmlakSoft personeli, departman kapısından sonra) servis istemcisiyle.
 */
import { getListScope } from "@/lib/access-control";
import { getEffectivePermissions, immutableReadonlyPermissions } from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import type { ReportContext, ReportDb } from "./types";

export type TenantGate = { userId: string; tenantId: string; role: string; impersonating: boolean };

export async function buildTenantContext(gate: TenantGate): Promise<ReportContext & { logoUrl: string | null }> {
  const supabase = await createClient();
  const perms = gate.impersonating ? immutableReadonlyPermissions() : await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  const officeWide = hasOfficeWideDataScope(gate.role);
  const [scope, sample, tenant] = await Promise.all([
    getListScope({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role, mineOnly: !officeWide }),
    loadSampleKpiScope(supabase, gate.tenantId),
    supabase.from("tenants").select("name, logo_url").eq("id", gate.tenantId).maybeSingle(),
  ]);
  const t = (tenant.data ?? null) as { name?: string | null; logo_url?: string | null } | null;
  return {
    scope: "tenant",
    supabase: supabase as ReportDb,
    tenantId: gate.tenantId,
    userId: gate.userId,
    role: gate.role,
    officeWide,
    seeAllEarnings: !gate.impersonating && canSeeAllEarnings(perms),
    perms,
    listScope: scope.filter,
    officeName: t?.name?.trim() || "Ofis",
    sample,
    names: new Map(),
    memo: new Map(),
    logoUrl: t?.logo_url ?? null,
  };
}

/** Platform bağlamı. Servis istemcisi YALNIZ burada oluşturulur (kabul listesi: admin-client-allowlist). */
export function buildPlatformContext(staff: { id: string; role: string }): ReportContext {
  return {
    scope: "platform",
    supabase: createAdminClient() as ReportDb,
    tenantId: null,
    userId: staff.id,
    role: staff.role,
    officeWide: true,
    seeAllEarnings: true,
    perms: {},
    listScope: { kind: "none" },
    officeName: "EmlakSoft Platform",
    sample: {
      include: true,
      counts: { realCustomers: 0, realProperties: 0 },
      seeded: false,
      label: null,
      values: [true, false],
      apply: <Q,>(query: Q) => query,
    },
    names: new Map(),
    memo: new Map(),
  };
}
