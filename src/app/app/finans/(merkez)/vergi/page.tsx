import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { VergiTab } from "../_tabs/vergi";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("vergi") };

/** Finans > Vergi: KDV ve stopaj özeti. */
export default async function Page({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return (
    <FinanceBody>
      <VergiTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />
    </FinanceBody>
  );
}
