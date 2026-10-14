import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { SIDEBAR_BOOT_SCRIPT } from "@/components/ui/console/sidebar-boot";
import {
  CSP_REPORT_PATH,
  INLINE_SCRIPT_HASHES,
  buildReportOnlyCsp,
  isReportOnlyPath,
  newCspNonce,
  reportOnlyEnabled,
  reportingEndpointsHeader,
} from "./csp-report-only";

const sha = (s: string) => `sha256-${createHash("sha256").update(s).digest("base64")}`;
const REPORT_URL = `https://emlaksoft.com.tr${CSP_REPORT_PATH}`;

describe("CSP rapor modu politikası", () => {
  it("satır içi önyükleme betiklerinin özetleri kaynakla aynı (betik değişince özet de güncellenmeli)", () => {
    expect(INLINE_SCRIPT_HASHES.themeBoot).toBe(sha(THEME_BOOT_SCRIPT));
    expect(INLINE_SCRIPT_HASHES.sidebarBoot).toBe(sha(SIDEBAR_BOOT_SCRIPT));
  });

  it("nonce + strict-dynamic + özetler; rapor ucu iki biçimde", () => {
    const nonce = newCspNonce();
    const p = buildReportOnlyCsp(nonce, REPORT_URL);
    expect(p).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(p).toContain(`'${INLINE_SCRIPT_HASHES.themeBoot}'`);
    expect(p).toContain(`'${INLINE_SCRIPT_HASHES.sidebarBoot}'`);
    // Satır içi ihlaller ancak betik örneğiyle ayırt edilir.
    expect(p).toMatch(/script-src [^;]*'report-sample'/);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'self'");
    expect(p).toContain(`report-uri ${REPORT_URL}`);
    expect(p).toContain("report-to csp");
    // Yedekler yalnız eski tarayıcı içindir; 'unsafe-eval' yok.
    expect(p).not.toContain("unsafe-eval");
    expect(reportingEndpointsHeader(REPORT_URL)).toBe(`csp="${REPORT_URL}"`);
  });

  it("nonce her çağrıda farklı ve 128 bit base64; geçersiz nonce politikaya giremez", () => {
    const a = newCspNonce();
    const b = newCspNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(() => buildReportOnlyCsp("x'; script-src *", REPORT_URL)).toThrow();
  });

  it("kapsam yalnız /app ve /admin (statik/önbellekli herkese açık sayfalar nonce taşıyamaz)", () => {
    for (const p of ["/app", "/app/musteriler", "/admin", "/admin/sistem"]) expect(isReportOnlyPath(p), p).toBe(true);
    for (const p of ["/", "/gizlilik", "/vitrin/demo-ofis", "/giris", "/kayit", "/apple", "/administrator", "/api/admin/x"]) {
      expect(isReportOnlyPath(p), p).toBe(false);
    }
  });

  it("yalnız üretimde açık; CSP_REPORT_ONLY=off kapatır", () => {
    expect(reportOnlyEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(reportOnlyEnabled({ NODE_ENV: "production", CSP_REPORT_ONLY: "off" })).toBe(false);
    expect(reportOnlyEnabled({ NODE_ENV: "production", CSP_REPORT_ONLY: " OFF " })).toBe(false);
    expect(reportOnlyEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(reportOnlyEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("proxy bağlantısı (kaynak sözleşmesi)", () => {
  const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");

  it("politika hem istek başlığına (Next nonce'u buradan okur) hem yanıt başlığına yazılır; istemcinin başlığı silinir", () => {
    expect(proxy).toMatch(/request\.headers\.delete\(CSP_REPORT_ONLY_REQUEST_HEADER\)/);
    expect(proxy).toMatch(/request\.headers\.set\(CSP_REPORT_ONLY_REQUEST_HEADER, policy\)/);
    expect(proxy).toContain('"content-security-policy-report-only"');
    expect(proxy).toContain('response.headers.set("Content-Security-Policy-Report-Only", policy)');
    expect(proxy).toContain('response.headers.set("Reporting-Endpoints"');
  });

  it("yürürlükteki CSP değişmez: next.config.ts Content-Security-Policy'yi enforce etmeye devam eder, rapor modu ayrı başlık", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('{ key: "Content-Security-Policy", value: contentSecurityPolicy }');
    expect(config).not.toContain("Report-Only");
  });

  it("hem genel yol hem /admin yolu sarmalanır", () => {
    expect(proxy).toContain("return withReportOnlyCsp(await updateSession(request), cspPolicy);");
    expect(proxy).toContain("return withReportOnlyCsp(await applyIdlePolicy(request, response, policy.idleMinutes), cspPolicy);");
  });
});
