import type { ReactNode } from "react";
import { ArrowLeftRight, Landmark, LayoutDashboard } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/app/page-tabs";
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

/** Hero eylemleri: şema varsa "Gelir ekle / Gider ekle", yoksa eski "Yeni gider" bağlantısı. */
export function FinanceActions({
  cashAvailable,
  quickAccounts,
  defaultDate,
  canSalary,
  legacyCreate,
}: {
  cashAvailable: boolean;
  quickAccounts: readonly AccountOption[];
  defaultDate: string;
  canSalary: boolean;
  legacyCreate: ReactNode;
}) {
  return cashAvailable ? <QuickEntryButtons accounts={quickAccounts} defaultDate={defaultDate} canSalary={canSalary} /> : <>{legacyCreate}</>;
}

export const FINANCE_HERO_TEXT = {
  cash: { eyebrow: "Kasa, banka ve giderler", description: "Paranın hangi kasadan ve bankadan girip çıktığını, ofis giderlerini ve bakiyelerinizi tek yerden takip edin." },
  legacy: { eyebrow: "Gider takibi", description: "Ofis giderlerini kategorilere ve portföylere göre takip edin; fişleri bağlayın, ayları karşılaştırın." },
} as const;

/** Sekme şeridi; şema (kasa/banka) yokken görünmez. */
export function FinanceTabs({ cashAvailable, active }: { cashAvailable: boolean; active: FinanceTab }) {
  return cashAvailable ? <PageTabs base={FINANCE_BASE} label="Finans sekmeleri" tabs={FINANCE_TABS} active={active} /> : null;
}
