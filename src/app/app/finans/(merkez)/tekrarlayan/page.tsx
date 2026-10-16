import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { DuzenliTab } from "../_tabs/duzenli";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("tekrarlayan") };

/** Finans > Tekrarlayanlar: her ay tekrarlayan ödemeler ve onay bekleyenler. */
export default async function Page({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return (
    <FinanceBody>
      <DuzenliTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />
    </FinanceBody>
  );
}
