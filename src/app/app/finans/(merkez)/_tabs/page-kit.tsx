import type { ReactNode } from "react";
import { SkeletonCard } from "@/components/ui/viz";
import type { requireModulePage } from "@/lib/require-module-page";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import type { FinanceTabProps } from "@/lib/finance/ledger/types";

/**
 * Finans alt sayfalarının ortak sayfa kiti: `searchParams` düzleştirme ve sekme bileşenlerinin ortak `FinanceTabProps`'u.
 * Her alt sayfa kapıyı kendisi çağırır (`requireModulePage("expenses", FINANCE_ROOT)` = modül + Ofis paketi kilidi).
 */
export type FinanceSearchParams = Promise<Record<string, string | string[] | undefined>> | undefined;

export async function flatSearchParams(searchParams: FinanceSearchParams): Promise<Record<string, string | undefined>> {
  const raw = (await searchParams) ?? {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
}

type PageGate = Awaited<ReturnType<typeof requireModulePage>>;

/**
 * Sekme bileşenlerinin ortak prop'ları. Kapı sayfanın KENDİSİNDE çağrılır (`requireModulePage("expenses", FINANCE_ROOT)`;
 * sözleşme testleri sayfa kaynağında kapıyı arar), burada yalnız izinlerden türetilir.
 */
export async function financeTabProps(gate: PageGate, searchParams: FinanceSearchParams, extra: Record<string, string> = {}): Promise<FinanceTabProps> {
  const { perms, tenantId, userId, role } = gate;
  const params = await flatSearchParams(searchParams);
  return {
    params: { ...params, ...extra },
    perms,
    tenantId: tenantId ?? "",
    userId,
    role,
    canCreate: perms.expenses?.includes("create") ?? false,
    canEdit: perms.expenses?.includes("edit") ?? false,
    canDelete: perms.expenses?.includes("delete") ?? false,
    canSalary: canHandleSalary(role),
    isOwnerGm: role === "owner" || role === "gm",
  };
}

/** Alt sayfa gövdesi: kabuğun (layout) hero'sunun altındaki dikey akış. */
export function FinanceBody({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-4">{children}</div>;
}

/** Alt sayfa iskeleti (layout hero'su yerinde kalır; yalnız gövde yüklenir). */
export function FinanceSectionSkeleton({ label, kpis = true }: { label: string; kpis?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy="true">
      {kpis ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} variant="card" height={96} lines={2} label="Gösterge yükleniyor" />
          ))}
        </div>
      ) : null}
      <SkeletonCard height={420} label={label} />
    </div>
  );
}
