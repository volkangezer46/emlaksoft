"use client";

/**
 * Grafiklerin TEMBEL kapısı.
 *
 * SORUN: `@/components/ui/chart` modülünün ilk satırı `import { ... } from "recharts"`.
 * O modülden SADECE `ChartFrame` (recharts kullanmayan, düz bir kart çerçevesi)
 * içe aktarmak bile Recharts'ın tamamını sayfanın ilk paketine sokuyordu.
 * Ölçüm: grafik gösteren rotalar ~1.0 MB istemci JS'i ile açılıyordu; grafiği
 * hiç görmeyen kullanıcı bile bu maliyeti ödüyordu.
 *
 * ÇÖZÜM: `next/dynamic` (docs: 01-app/02-guides/lazy-loading.md). Recharts ayrı
 * bir parçaya (chunk) taşınıyor. `ssr` KAPATILMADI — sunucu HTML'i aynı kalıyor,
 * yani görünüm ve ilk boyama değişmiyor; yalnız ilk JS paketi küçülüyor.
 * ChartFrame artık ayrı (recharts'sız) modülde: statik export edilir, böylece
 * kart çerçevesi için bile grafik parçası indirilmez.
 *
 * NOT: Sunucu bileşeninden doğrudan `dynamic()` çağırmak kod bölmez
 * (lazy-loading.md: "When a Server Component dynamically imports a Client
 * Component, automatic code splitting is currently not supported"). Bu yüzden
 * kapı bir istemci modülü olmak ZORUNDA.
 */

import dynamic from "next/dynamic";

export { ChartFrame } from "@/components/ui/chart-frame";

const chartModule = () => import("@/components/ui/chart");

// Grafik parçası inerken ChartFrame'in sabit yüksekliğini dolduran sakin iskelet
// (düzen kayması yok; reduced-motion global kuralla animasyonu kapatır).
function ChartSkeleton() {
  return (
    <div
      role="status"
      aria-label="Grafik yükleniyor"
      className="h-full w-full animate-pulse rounded-[var(--radius-control)] bg-line"
    />
  );
}

export const AreaTrend = dynamic(() => chartModule().then((m) => m.AreaTrend), { loading: ChartSkeleton });
export const BarCompare = dynamic(() => chartModule().then((m) => m.BarCompare), { loading: ChartSkeleton });
export const DonutSplit = dynamic(() => chartModule().then((m) => m.DonutSplit), { loading: ChartSkeleton });
