import Link from "next/link";
import { ArrowLeft, Fingerprint, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppModule, AppRole } from "@/lib/permissions";
import { MODULE_LABELS, RolePermissionsMatrix } from "./role-permissions-matrix";
import { UserExceptions, type ExceptionMember, type OverrideRow } from "./user-exceptions";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "owner", label: "Ofis sahibi" },
  { value: "gm", label: "Genel müdür" },
  { value: "branch_manager", label: "Şube müdürü" },
  { value: "team_lead", label: "Takım lideri" },
  { value: "advisor", label: "Danışman" },
  { value: "call_center", label: "Çağrı merkezi" },
  { value: "accounting", label: "Muhasebe" },
  { value: "readonly", label: "Salt okunur" },
];

const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<string, string>;

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
];

export default async function RolePermissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string; tab?: string; user?: string }>;
}) {
  const ctx = await requireModulePage("settings");
  const params = (await searchParams) ?? {};
  const activeTab = params.tab === "istisnalar" ? "istisnalar" : "roller";
  const selectedRole = (ROLES.some((r) => r.value === params.role) ? params.role : "advisor") as AppRole;
  const isManager = ctx.role === "owner" || ctx.role === "gm";
  const isOwnerRole = selectedRole === "owner";

  const supabase = await createClient();

  // ---- Sekme: Kullanıcı istisnaları ----
  let exceptionMembers: ExceptionMember[] = [];
  let selectedUserId: string | null = null;
  let userOverrides: OverrideRow[] = [];
  let userRoleEffective: Awaited<ReturnType<typeof getEffectivePermissions>> = {};

  if (activeTab === "istisnalar") {
    const { data: membersData } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_active")
      .order("full_name", { ascending: true })
      .limit(500);
    exceptionMembers = (membersData ?? [])
      .filter((m) => m.is_active)
      .map((m) => ({
        id: m.id as string,
        full_name: m.full_name as string,
        role: m.role as string,
        roleLabel: ROLE_LABEL[m.role as string] ?? (m.role as string),
      }));

    const requested = (params.user ?? "").trim();
    const selectedMember = exceptionMembers.find((m) => m.id === requested && m.role !== "owner") ?? null;
    selectedUserId = selectedMember?.id ?? null;

    if (selectedMember && ctx.tenantId) {
      // Rol katmanlı etkin izin (kullanıcı istisnası HARİÇ — soluk taban bunun üstüne çizilir)
      const [{ data: overrideRows }, effective] = await Promise.all([
        supabase
          .from("user_permission_overrides")
          .select("module, actions, expires_at")
          .eq("tenant_id", ctx.tenantId)
          .eq("user_id", selectedMember.id),
        getEffectivePermissions(ctx.tenantId, selectedMember.role),
      ]);
      userOverrides = (overrideRows ?? []) as OverrideRow[];
      userRoleEffective = effective;
    }
  }

  // ---- Sekme: Rol izinleri ----
  const [{ data: overrideRows }, effective] =
    activeTab === "roller"
      ? await Promise.all([
          ctx.tenantId
            ? supabase
                .from("tenant_role_permissions")
                .select("module, action")
                .eq("tenant_id", ctx.tenantId)
                .eq("role", selectedRole)
            : Promise.resolve({ data: [] as { module: string; action: string }[] }),
          getEffectivePermissions(ctx.tenantId, selectedRole),
        ])
      : [{ data: [] as { module: string; action: string }[] }, {} as Awaited<ReturnType<typeof getEffectivePermissions>>];
  const overriddenCells = (overrideRows ?? []).map((r) => `${r.module}:${r.action}`);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-brand-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Ayarlara dön
        </Link>
      </div>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <Fingerprint className="h-4 w-4" /> Rol & izin yönetimi
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">İzin matrisi</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Her rolün hangi modüle hangi işlemle erişebileceğini bu ekrandan özelleştirin. Değişiklikler yalnızca bu ofisi
            etkiler ve anında etkin olur. Kişiye özel durumlar için &quot;Kullanıcı istisnaları&quot; sekmesini kullanın.
          </p>
        </div>
      </section>

      {/* Sekmeler: rol matrisi / kullanıcı istisnaları */}
      <div className="flex gap-2">
        <Link
          href="/app/ayarlar/roller"
          className={`rounded-[10px] px-3.5 py-2 text-xs font-semibold transition ${
            activeTab === "roller"
              ? "bg-ink-950 text-white"
              : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
          }`}
        >
          Rol izinleri
        </Link>
        <Link
          href="/app/ayarlar/roller?tab=istisnalar"
          className={`rounded-[10px] px-3.5 py-2 text-xs font-semibold transition ${
            activeTab === "istisnalar"
              ? "bg-ink-950 text-white"
              : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
          }`}
        >
          Kullanıcı istisnaları
        </Link>
      </div>

      {activeTab === "istisnalar" ? (
        <UserExceptions
          key={selectedUserId ?? "none"}
          members={exceptionMembers}
          selectedUserId={selectedUserId}
          roleEffective={userRoleEffective}
          overrides={userOverrides}
          modules={MODULES}
          moduleLabels={MODULE_LABELS}
          readOnly={!isManager}
        />
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ROLES.map((r) => (
              <Link
                key={r.value}
                href={`/app/ayarlar/roller?role=${r.value}`}
                className={`shrink-0 rounded-[10px] px-3.5 py-2 text-xs font-semibold transition ${
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
            <section className="rounded-[20px] border border-dashed border-line-strong bg-surface p-6 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
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
        </>
      )}
    </div>
  );
}
