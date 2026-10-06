"use client";

/**
 * Recharts'ı (~400 KB) sayfanın ilk paketinden çıkaran istemci kapısı.
 * Sunucu bileşeninden doğrudan `dynamic()` kod bölmez (lazy-loading.md); bu yüzden
 * kapı bir istemci modülüdür. Sunucu HTML'i (iskelet -> grafik) aynı kalır.
 */

import dynamic from "next/dynamic";
import { SkeletonCard } from "@/components/ui/viz";

export const RevenueChart = dynamic(() => import("./revenue-chart").then((m) => m.RevenueChart), {
  loading: () => <SkeletonCard height="100%" label="Grafik yükleniyor" />,
});
