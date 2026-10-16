import { FINANCE_ROOT } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { notFound } from "next/navigation";
import { uuidParam } from "@/components/ui/list-kit/list-logic";
import { CariTab } from "../../_tabs/cari";
import { financeTitle } from "../../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../../_tabs/page-kit";

export const metadata = { title: financeTitle("cari") };

/** Finans > Cari detayı (`/app/finans/cari/<id>`): ekstre, açık kalemler, Tahsil et / Öde; malik ve danışman bölümleri. */
export default async function CariDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: FinanceSearchParams }) {
  const { id } = await params;
  const partyId = uuidParam(id);
  if (!partyId) notFound();
  return (
    <FinanceBody>
      <CariTab {...await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams, { cari: partyId })} />
    </FinanceBody>
  );
}
