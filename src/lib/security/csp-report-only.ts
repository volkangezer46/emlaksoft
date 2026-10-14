/**
 * CSP ÖLÇÜM KATMANI (yalnız rapor modu): `script-src 'nonce-…' 'strict-dynamic'` politikasına geçmeden önce neyin
 * kırılacağını ölçmek için `Content-Security-Policy-Report-Only` başlığı. Hiçbir şeyi ENGELLEMEZ; yürürlükteki politika
 * next.config.ts'teki `Content-Security-Policy` olarak kalır.
 *
 * Kapsam: yalnız /app ve /admin belge istekleri (zaten dinamik; Next istek başlığındaki nonce'u kendi betiklerine
 * ekler). Statik/önbellekli herkese açık sayfalar nonce taşıyamaz: oralara eklenirse her betik "ihlal" görünür, ölçüm
 * anlamsızlaşır. Raporlar `/api/csp-rapor` ucuna gelir ve error_logs'a (kaynak "csp") toplanır.
 *
 * SAF dosya (G/Ç yok, Node'a özgü API yok): proxy'de (her istek) ve testte aynı kod çalışır.
 * Kapatma: env `CSP_REPORT_ONLY=off` (yeniden başlatma gerekir). Geliştirmede kapalıdır.
 */

export const CSP_REPORT_PATH = "/api/csp-rapor";
/** Reporting API uç adı (`report-to csp`). */
export const CSP_REPORT_GROUP = "csp";

/**
 * Bilinen satır içi önyükleme betiklerinin özetleri. Kök layout'taki tema betiği (src/lib/theme.ts THEME_BOOT_SCRIPT)
 * ve konsol yan menü betiği (src/components/ui/console/sidebar-boot.tsx SIDEBAR_BOOT_SCRIPT) nonce alamaz: kök layout
 * statik sayfaları da çizer, `headers()` okuyamaz. Betik metni değişirse özet de değişmelidir
 * (src/lib/security/csp-report-only.test.ts kaynaktan yeniden hesaplayıp karşılaştırır).
 */
export const INLINE_SCRIPT_HASHES = {
  themeBoot: "sha256-LksNZ2zRFViRT5Uaa5ma3TFyJ25j6k7f5P1IBHdic0I=",
  sidebarBoot: "sha256-77TapEol/dNdMzJZw9OzdDZ0epAs4spgzuBMoC5suGg=",
} as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Rapor modu açık mı? Yalnız üretim derlemesinde ve env ile kapatılmamışsa. */
export function reportOnlyEnabled(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  return env.CSP_REPORT_ONLY?.trim().toLowerCase() !== "off";
}

/** Rapor modu yalnız panel belgelerinde (/app, /admin ve alt yolları). */
export function isReportOnlyPath(path: string): boolean {
  return path === "/app" || path.startsWith("/app/") || path === "/admin" || path.startsWith("/admin/");
}

/** 128 bit rastgele nonce (base64). Web Crypto: Node ve Edge çalışma zamanında aynı. */
export function newCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const NONCE_RE = /^[A-Za-z0-9+/]{16,64}={0,2}$/;

/**
 * Önerilen sıkı politika (rapor modunda). `'unsafe-inline'` ve `https:` yalnız nonce/strict-dynamic bilmeyen eski
 * tarayıcılar için yedektir; bilen tarayıcı ikisini de yok sayar. Diğer yönergeler yürürlükteki politikayla aynı
 * kalır (ölçülen tek değişiklik betik yükleme modeli).
 */
export function buildReportOnlyCsp(nonce: string, reportUrl: string): string {
  if (!NONCE_RE.test(nonce)) throw new Error("geçersiz nonce");
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' '${INLINE_SCRIPT_HASHES.themeBoot}' '${INLINE_SCRIPT_HASHES.sidebarBoot}' 'unsafe-inline' https:`,
    "object-src 'none'",
    "base-uri 'self'",
    `report-uri ${reportUrl}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join("; ");
}

/** `Reporting-Endpoints` başlık değeri (Reporting API; `report-to` yönergesi bu adı kullanır). */
export function reportingEndpointsHeader(reportUrl: string): string {
  return `${CSP_REPORT_GROUP}="${reportUrl}"`;
}
