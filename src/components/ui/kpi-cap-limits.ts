/**
 * Dengeli görünümde KPI şeridi sınırı (sahip kararı 2026-10-16): masaüstünde en çok 6, telefonda 2 kart; kalanı
 * "Tüm göstergeler" ile açılır. Sunucu bileşenleri (KpiStrip, MetrikSeridi) ve istemci `KpiCap` AYNI sabiti okur —
 * "use client" modülünden sabit içe aktarılamadığı için ayrı düz modüldedir.
 */
export const KPI_CAP_DESKTOP = 6;
export const KPI_CAP_PHONE = 2;
