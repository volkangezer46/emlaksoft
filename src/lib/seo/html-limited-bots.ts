import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";

/**
 * Metadata'yı akışla (<body> sonuna) DEĞİL, bloklayarak <head> içinde alacak user-agent'lar (next.config `htmlLimitedBots`).
 *
 * Next 16 varsayılanı yalnız "HTML-limited" botları (Bingbot, Yandex, *-Google, sosyal önizleyiciler) bloklar; ana arama
 * robotu Googlebot "JS çalıştırır" diye akışlı metadata alır. `loading.tsx` taşıyan rotalarda (ör. /vitrin/[slug]/[ilan])
 * bu, <title>/description/canonical/robots etiketlerinin Googlebot'un ilk HTML'inde <body>'ye düşmesi demek.
 *
 * Kural: Next'in VARSAYILAN listesi aynen korunur (sürüm yükseltmelerinde kendiliğinden güncellenir) + Googlebot eklenir.
 * İnsan tarayıcıları eşleşmez → açılış ekranı ve akışlı metadata (hızlı TTFB) onlar için aynen kalır.
 * `/.*\/` (akışlı metadata'yı herkese kapatmak) YASAK — HIZ ANA İLKESİ (sözleşme: vitrin-seo.test.ts).
 */
export const HTML_LIMITED_BOTS = new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`, "i");
