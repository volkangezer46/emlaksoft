import type { ReactNode } from "react";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { EarningsTabs } from "./earnings-tabs";

/**
 * Kazancım kabuğu (kişisel): Kazancım (komisyon payım, hakediş, bordro) ve Kasam (kişisel kasa) iç sekmeleri.
 * Asıl kapı her sayfadadır (Kazancım `commissions`, Kasam `dashboard`).
 */
export default async function EarningsLayout({ children }: { children: ReactNode }) {
  const { perms } = await requireModulePage("dashboard");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <EarningsTabs earnings={effectiveCanAccessModule(perms, "commissions")} />
      {children}
    </div>
  );
}
