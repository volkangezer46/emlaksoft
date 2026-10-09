"use client";

import type { ComponentType } from "react";
import type { TourItem } from "@/lib/site-content/schema";
import { AutomationScreen, CommissionScreen, CustomersScreen, DealsScreen, PortfolioScreen, ReportsScreen, TodayScreen } from "./screens";

/**
 * Ürün turu ekranlarının İSTEMCİ haritası. Yalnız `lazy-screen.tsx` dinamik olarak yükler (ayrı parça): ilk boyama
 * yolunda değildir. Ekranlar saf SVG'dir (durum/etki yok); sunucuda çizilenle aynı bileşenlerdir.
 */
export const CLIENT_SCREENS: Record<TourItem["id"], ComponentType> = {
  bugun: TodayScreen,
  musteriler: CustomersScreen,
  portfoy: PortfolioScreen,
  anlasmalar: DealsScreen,
  komisyon: CommissionScreen,
  raporlar: ReportsScreen,
  otomasyon: AutomationScreen,
};
