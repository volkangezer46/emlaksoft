import { FilterChip } from "@/components/ui/filter-chip";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppModule, AppRole } from "@/lib/permissions";
import { canEditRolePermissions } from "@/lib/access-control/admin-rules";
import { ROLE_LABELS } from "@/lib/role-labels";
import { RolePermissionsMatrix } from "./role-permissions-matrix";

export const ROLES: { value: AppRole; label: string }[] = (
  ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as AppRole[]
).map((value) => ({ value, label: ROLE_LABELS[value] ?? value }));

/** Rol izin matrisinde gösterilen modüller (yeni modül = buraya da eklenir; bkz. CLAUDE.md "Yeni modül = 4 kayıt yeri"). */
export const ROLE_MATRIX_MODULES: AppModule[] = [
  "dashboard",
  "customers",
  "demands",
  "properties",
  "matching",
  "portals",
  "leak",
  "appointments",
  "calls",
  "commissions",
  "tasks",
  "team",
  "support",
  "settings",
  "billing",
  "reports",
  "valuation",
  "compliance",
  "campaigns",
  "contracts",
  "expenses",
  "offers",
  "targets",
  "open_house",
  "rentals",
  "projects",
  "network",
  "surveys",
  "earnings_all",
  "prospecting",
];

export function parseMatrixRole(raw: string | undefined): AppRole {
  return (ROLES.some((r) => r.value === raw) ? raw : "advisor") as AppRole;
}

/**
 * Yetkiler > Roller (ilk sekme): rol izin matrisi. Seçili rol `?role=` ile URL'de durur. Kişiye özel istisnalar
 * aynı sayfanın "İzin istisnaları" sekmesindedir. Ofis sahibi rolü düzenlenemez (kilitlenme koruması).
 */
export async function RolesSection({
  tenantId,
  viewerRole,
  selectedRole,
  roleHref,
}: {
  tenantId: string | null;
  viewerRole: string;
  selectedRole: AppRole;
  roleHref: (role: AppRole) => string;
}) {
  // Tek kural (admin-rules): owner/gm düzenler, gm kendi (gm) satırını düzenlemez. Eylem ve RLS aynı kuralı uygular.
  const editRule = canEditRolePermissions(viewerRole, selectedRole);
  const supabase = await createClient();
  const [{ data: overrideRows }, effective] = await Promise.all([
    tenantId
      ? supabase.from("tenant_role_permissions").select("module, action").eq("tenant_id", tenantId).eq("role", selectedRole)
      : Promise.resolve({ data: [] as { module: string; action: string }[] }),
    getEffectivePermissions(tenantId, selectedRole),
  ]);
  const overriddenCells = (overrideRows ?? []).map((r) => `${r.module}:${r.action}`);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ROLES.map((r) => (
          <FilterChip key={r.value} href={roleHref(r.value)} active={selectedRole === r.value}>
            {r.label}
          </FilterChip>
        ))}
      </div>

      {selectedRole === "owner" ? (
        <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-4 text-center md:p-6">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Ofis sahibi her zaman tam yetkilidir</h2>
          <p className="mt-1.5 text-sm text-text-muted">Kilitlenme riskine karşı bu rol düzenlenemez; tüm modüllere her zaman erişimi vardır.</p>
        </section>
      ) : (
        // key: rol çipi değişince matris sıfırdan kurulur; önceki rolün yerel durumu yeni role yazılamaz (B162).
        <RolePermissionsMatrix
          key={selectedRole}
          role={selectedRole}
          modules={ROLE_MATRIX_MODULES}
          effective={effective}
          overriddenCells={overriddenCells}
          readOnly={!editRule.ok}
          readOnlyReason={editRule.ok ? null : editRule.reason}
        />
      )}
    </div>
  );
}
