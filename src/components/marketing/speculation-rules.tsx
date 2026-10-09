/**
 * Speculation Rules (Chromium): üst bardan (SiteHeader) görünen YALNIZ public pazarlama sayfalarında bir sonraki
 * geçişi imleç üstüne gelince (eagerness "moderate") önceden getirir/çizer. Next 16 belgelerinde bu iş için yerleşik
 * bir yol yok; standart `<script type="speculationrules">` kullanılır. CSP `script-src 'unsafe-inline'` bunu karşılar.
 * Kurallar:
 *  - /app, /admin, token'lı yüzeyler (portal, imza, ödeme linki) ve oturum/yan etki yolları ASLA listelenmez.
 *  - Statik sayfa (fiyatlar) prerender; dinamik giriş/kayıt yalnız prefetch (yan etkili istemci kodu çalışmaz).
 *  - Chromium dışı tarayıcıda yok sayılır. Veri/çerez ayrımı: prefetch aynı kaynaklı, kimlik bilgisi aynı istek kuralıdır.
 */
export const SPECULATION_RULES = {
  prerender: [{ urls: ["/fiyatlar"], eagerness: "moderate" }],
  prefetch: [{ urls: ["/kayit", "/giris"], eagerness: "moderate" }],
} as const;

export function SpeculationRules() {
  return <script type="speculationrules" dangerouslySetInnerHTML={{ __html: JSON.stringify(SPECULATION_RULES) }} />;
}
