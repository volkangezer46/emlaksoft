import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { RaporlarTab } from "../_tabs/raporlar";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("raporlar") };

/** Finans > Raporlar: kâr-zarar ve dönem raporları. */
export default async function Page({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return (
    <FinanceBody>
      <RaporlarTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />
    </FinanceBody>
  );
}
