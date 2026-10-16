import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { FaturalarTab, type FaturalarParams } from "./faturalar-tab";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("faturalar") };

/** Finans > Faturalar (`/app/finans/faturalar`): e-Fatura / e-Arşiv listesi, taslak ve resmileştirme. */
export default async function FaturalarPage({ searchParams }: { searchParams?: FinanceSearchParams }) {
  const { params, perms, tenantId } = await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams);
  const fp: FaturalarParams = {
    durum: params.durum,
    kaynak: params.kaynak,
    id: params.id,
    duzenle: params.duzenle,
    adet: params.adet,
    tutar: params.tutar,
    kdv: params.kdv,
    aciklama: params.aciklama,
    alici: params.alici,
  };
  return (
    <FinanceBody>
      <FaturalarTab tenantId={tenantId} perms={perms} params={fp} embedded />
    </FinanceBody>
  );
}
