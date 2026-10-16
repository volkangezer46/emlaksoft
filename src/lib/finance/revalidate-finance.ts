import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { earningsPath, financePath } from "@/lib/finance/routes";

/**
 * Finans yazmasından sonra tazeleme (TEK yer): Finans merkezinin TÜM alt yolları (`/app/finans/**`, layout kapsamı) ve
 * Kazancım + Kasam (`/app/kazancim/**`) + ofis rapor/agrega önbellekleri.
 */
export function revalidateFinance(tenantId: string | null | undefined): void {
  revalidatePath(financePath(), "layout");
  revalidatePath(earningsPath(), "layout");
  revalidateTenantData(tenantId);
}
