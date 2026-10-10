import type { ReactNode } from "react";
import { ArrowLeftRight, Landmark, LayoutDashboard } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { ListHero } from "@/components/ui/list-page";
import { QuickEntryButtons, type AccountOption } from "../quick-entry";

/**
 * Finans sayfasının ortak üst kısmı: başlık + "Gelir ekle / Gider ekle" (HER sekmede) + sekme şeridi (?sekme=).
 * Şema (kasa/banka) yokken sekme şeridi ve hızlı düğmeler görünmez; sayfa eski Giderler akışıyla çalışır.
 */
export const FINANCE_BASE = "/app/giderler";

export const FINANCE_TABS: readonly PageTab[] = [
  { id: "ozet", label: "Özet", icon: LayoutDashboard },
  { id: "hareketler", label: "Hareketler", icon: ArrowLeftRight },
  { id: "kasa-banka", label: "Kasa ve banka", icon: Landmark },
];

export type FinanceTab = "ozet" | "hareketler" | "kasa-banka";

export function financeTabOf(value: string | string[] | undefined): FinanceTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "hareketler" || v === "kasa-banka" ? v : "ozet";
}

export function FinanceHero({
  cashAvailable,
  active,
  meta,
  quickAccounts,
  defaultDate,
  canSalary,
  legacyCreate,
}: {
  cashAvailable: boolean;
  active: FinanceTab;
  meta?: ReactNode;
  quickAccounts: readonly AccountOption[];
  defaultDate: string;
  canSalary: boolean;
  /** Şema yokken eski "Yeni gider" bağlantısı (yetki varsa). */
  legacyCreate: ReactNode;
}) {
  return (
    <>
      <ListHero
        eyebrow={cashAvailable ? "Kasa, banka ve giderler" : "Gider takibi"}
        art="gider"
        title="Finans"
        meta={meta}
        description={
          cashAvailable
            ? "Paranın hangi kasadan ve bankadan girip çıktığını, ofis giderlerini ve bakiyelerinizi tek yerden takip edin."
            : "Ofis giderlerini kategorilere ve portföylere göre takip edin; fişleri bağlayın, ayları karşılaştırın."
        }
        actions={cashAvailable ? <QuickEntryButtons accounts={quickAccounts} defaultDate={defaultDate} canSalary={canSalary} /> : legacyCreate}
      />
      {cashAvailable ? <PageTabs base={FINANCE_BASE} label="Finans sekmeleri" tabs={FINANCE_TABS} active={active} /> : null}
    </>
  );
}
