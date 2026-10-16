import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { earningsPath, financePath } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody } from "../_tabs/page-kit";
import { OfficeEarnings } from "./office-earnings";

export const metadata = { title: financeTitle("hakedis") };

/**
 * Finans > Hakediş (`/app/finans/hakedis`): danışman bazlı ofis geneli hakediş ve ödeme durumu. Kapı: Komisyon modülü +
 * Ofis paketi (`/app/finans` kilidi); kazanç gizliliği gereği tablo yalnız `earnings_all` izniyle çizilir, diğer roller
 * kendi kazancına (Kazancım) yönlendirilir (bağlantıyla, yönlendirmeyle değil).
 */
export default async function HakedisPage() {
  const { userId, tenantId, role, perms } = await requireModulePage("commissions", financePath("hakedis"));
  if (!canSeeAllEarnings(perms)) {
    return (
      <FinanceBody>
        <EmptyState
          icon={Lock}
          tone="amber"
          title="Ofis geneli hakediş yönetime açıktır"
          description="Danışman bazlı hakediş tablosu kazanç gizliliği nedeniyle yalnız ofis yönetimine görünür. Kendi kazancınızı Kazancım'da izleyebilirsiniz."
          action={{ href: earningsPath(), label: "Kazancım'a git" }}
          secondary={{ href: financePath("komisyon"), label: "Komisyon defteri" }}
        />
      </FinanceBody>
    );
  }
  return (
    <FinanceBody>
      <OfficeEarnings viewer={{ userId, role, perms }} tenantId={tenantId} />
    </FinanceBody>
  );
}
