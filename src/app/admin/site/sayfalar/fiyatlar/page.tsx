import { BadgePercent } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { defaultPricingPage } from "@/lib/pricing-page/defaults";
import { samePricing } from "@/lib/pricing-page/schema-core";
import { pricingPageStore } from "@/lib/pricing-page/store";
import { PricingPageEditor, type PricingHistoryView } from "./pricing-editor";

export const metadata = { title: "Fiyatlar sayfası metinleri" };

/** /fiyatlar metinleri ve SSS (taslak/yayın, sürüm geçmişi, varsayılana dön). Fiyat sayıları plan editöründen gelir. */
export default async function AdminPricingPageEditor() {
  const staff = await requirePlatformModule("sitecontent");
  const state = await pricingPageStore.readState();
  const defaults = defaultPricingPage();
  const draft = state.draft ?? state.live ?? defaults;
  const history: PricingHistoryView[] = state.history.map((h, i) => ({
    id: h.id,
    atLabel: toTrLocalInput(h.at).replace("T", " "),
    by: h.by,
    label: h.label,
    isLive: i === 0 && state.live !== null && samePricing(h.cfg, state.live),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="coupon"
        eyebrow="Sayfalar · sistem sayfası"
        icon={BadgePercent}
        title="Fiyatlar sayfası"
        description="Başlıklar, kartlar, bölüm metinleri ve SSS buradan yönetilir. Fiyat, limit ve paket kapsamı plan editöründen gelir; burada yazılmaz. Hiç yayın yokken sayfa bugünkü metinle çalışır."
        glow="brand"
      />
      <PricingPageEditor initialDraft={draft} live={state.live} defaults={defaults} history={history} canWrite={staff.role === "super_admin"} />
    </div>
  );
}
