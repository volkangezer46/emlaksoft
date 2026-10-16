import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { GenelBakisTab } from "./_tabs/genel-bakis";
import { financeTitle } from "./_tabs/finance-shell";
import { financeTabProps, type FinanceSearchParams } from "./_tabs/page-kit";

export const metadata = { title: financeTitle("genel") };

/** Finans > Genel bakış (`/app/finans`): nakit, alacak/borç, yaklaşan ödemeler ve akıllı kartlar. */
export default async function FinansPage({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return <GenelBakisTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />;
}
