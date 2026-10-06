import { createHtmlAdapter, PORTAL_RULES } from "./create";

/** Hepsiemlak ilan/mağaza sayfası ayrıştırıcısı (SAF). Kurallar `portal-rules.json` > `hepsiemlak` (DOĞRULANMADI, sürümlü). */
export const hepsiemlakHtml = createHtmlAdapter("hepsiemlak", PORTAL_RULES.portals.hepsiemlak);
