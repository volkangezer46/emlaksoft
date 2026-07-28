"use client";

/**
 * `CategoryDonut` Recharts kullanıyor ve sayfa açılışında ekranın alt yarısında
 * duruyor. Sunucu bileşeninden doğrudan `dynamic()` çağırmak kod bölmediği için
 * (lazy-loading.md) bu istemci kapısı gerekiyor: Recharts ayrı bir parçaya taşınır,
 * sunucu HTML'i (dolayısıyla görünüm) aynı kalır.
 */

import dynamic from "next/dynamic";

export const CategoryDonut = dynamic(() => import("./category-donut").then((m) => m.CategoryDonut));
