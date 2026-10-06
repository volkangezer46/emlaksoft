import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppModule, AppRole } from "@/lib/permissions";
import { PERMISSION_EDITOR_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { ROLE_LABELS } from "@/lib/role-labels";
import { RolePermissionsMatrix } from "./role-permissions-matrix";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
const ROLES: { value: AppRole; label: string }[] = (
  ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as AppRole[]
).map((value) => ({ value, label: ROLE_LABELS[value] ?? value }));

const MODULES: AppModule[] = [
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
];

/**
 * Rol izin matrisi. Kişi bazlı istisnalar /app/ayarlar/yetkilendirme (İzin istisnaları sekmesi) altına taşındı:
 * eski `?tab=istisnalar[&user=]` adresi oraya yönlendirir (yer imleri çalışır), tek ekran kalır.
 */
export default async function RolePermissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string; tab?: string; user?: string }>;
}) {
  const ctx = await requireModulePage("settings");
  const params = (await searchParams) ?? {};
  if (params.tab === "istisnalar") {
    const user = (params.user ?? "").trim();
    redirect(`/app/ayarlar/yetkilendirme?sekme=izinler${user ? `&user=${encodeURIComponent(user)}` : ""}`);
  }
  const selectedRole = (ROLES.some((r) => r.value === params.role) ? params.role : "advisor") as AppRole;
  const isManager = PERMISSION_EDITOR_ROLES.includes(ctx.role as TeamRole);
  const isOwnerRole = selectedRole === "owner";

  const supabase = await createClient();

  const [{ data: overrideRows }, effective] = await Promise.all([
    ctx.tenantId
      ? supabase
          .from("tenant_role_permissions")
          .select("module, action")
          .eq("tenant_id", ctx.tenantId)
          .eq("role", selectedRole)
      : Promise.resolve({ data: [] as { module: string; action: string }[] }),
    getEffectivePermissions(ctx.tenantId, selectedRole),
  ]);
  const overriddenCells = (overrideRows ?? []).map((r) => `${r.module}:${r.action}`);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Ayarlara dön
        </Link>
      </div>

      <PageHeader
        title="İzin matrisi"
        eyebrow="Rol & izin yönetimi"
        description={
          <>
            Her rolün hangi sayfada neleri yapabileceğini bu ekrandan ayarlayın. Değişiklikler yalnızca bu ofisi etkiler ve hemen geçerli olur.
            Kişiye özel istisnalar, kullanıcı kapsamları (kendi / takım / şube) ve denetim günlüğü{" "}
            <Link href="/app/ayarlar/yetkilendirme" className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
              Yetkilendirme <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>{" "}
            ekranındadır. <HelpTip topic="yetki-matrisi" />
          </>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {ROLES.map((r) => (
          <Link
            key={r.value}
            href={`/app/ayarlar/roller?role=${r.value}`}
            className={`shrink-0 rounded-[var(--radius-control)] px-3.5 py-2 text-xs font-semibold transition ${
              selectedRole === r.value
                ? "bg-ink-950 text-white"
                : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {isOwnerRole ? (
        <section className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-4 md:p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Ofis sahibi her zaman tam yetkilidir</h2>
          <p className="mt-1.5 text-sm text-text-muted">
            Kilitlenme riskine karşı bu rol bu ekrandan düzenlenemez — tüm modüllere her zaman erişimi vardır.
          </p>
        </section>
      ) : (
        <RolePermissionsMatrix
          role={selectedRole}
          modules={MODULES}
          effective={effective}
          overriddenCells={overriddenCells}
          readOnly={!isManager}
        />
      )}
    </div>
  );
}
