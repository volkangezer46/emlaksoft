import { createHtmlAdapter, PORTAL_RULES } from "./create";

/** Emlakjet ilan/mağaza sayfası ayrıştırıcısı (SAF). Kurallar `portal-rules.json` > `emlakjet` (DOĞRULANMADI, sürümlü). */
export const emlakjetHtml = createHtmlAdapter("emlakjet", PORTAL_RULES.portals.emlakjet);
