import { createHtmlAdapter, PORTAL_RULES } from "./create";

/**
 * Sahibinden ilan/mağaza sayfası ayrıştırıcısı (SAF). Yalnız kullanıcının kendi tarayıcısında, kendi görebildiği sayfa
 * eklenti tarafından alınır; kurallar `portal-rules.json` > `sahibinden` (DOĞRULANMADI, sürümlü).
 */
export const sahibindenHtml = createHtmlAdapter("sahibinden", PORTAL_RULES.portals.sahibinden);
