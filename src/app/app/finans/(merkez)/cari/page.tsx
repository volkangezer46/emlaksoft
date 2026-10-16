import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { CariTab } from "../_tabs/cari";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("cari") };

/** Finans > Cari: cari listesi ve açık kalemler/yaşlandırma (`?gorunum=acik`); detay `/app/finans/cari/[id]`. */
export default async function Page({ searchParams }: { searchParams?: FinanceSearchParams }) {
  return (
    <FinanceBody>
      <CariTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams)} />
    </FinanceBody>
  );
}
