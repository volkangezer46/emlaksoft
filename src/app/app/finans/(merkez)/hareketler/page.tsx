import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { HareketlerTab } from "../_tabs/hareketler";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("hareketler") };

/** Finans > Hareketler (`/app/finans/hareketler`): defter, süzgeçler ve kayıtlı görünümler. */
export default async function Page({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return (
    <FinanceBody>
      <HareketlerTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />
    </FinanceBody>
  );
}
