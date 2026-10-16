"use client";

import dynamic from "next/dynamic";

/**
 * CountUp tembel sarmalayıcısı (sunucu bileşenleri için): sayaç ve animasyon denetleyicisi panel rotalarının ilk yük
 * JS'inden çıkar. Sunucu çıktısı SONUÇ değeridir (ssr açık), parça inene kadar aynı metin ekranda kalır — CLS yok.
 * Para ve adet değerleri buraya hiç gelmez (`count-up-kind`: animasyonları kapalı, düz metin).
 */
export const CountUpLazy = dynamic(() => import("./count-up").then((m) => m.CountUp));
