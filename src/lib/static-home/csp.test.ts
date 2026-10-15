import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes, staticPageCsp, staticSecurityHeaders } from "./csp";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

describe("statik sayfa CSP'si", () => {
  const html =
    '<head><script>var a=1</script><script type="application/ld+json">{"x":1}</script><script type="speculationrules">{"prefetch":[]}</script></head>' +
    '<body><script type="application/json" id="mk-static">{"islands":{}}</script><script src="/statik/x.js"></script><script>var a=1</script><script type="module">import("/statik/y.js")</script></body>';

  it("yalnız çalıştırılabilir satır içi betikler özetlenir (JSON veri blokları ve dış betik hariç), tekrar yok", () => {
    expect(inlineScriptHashes(html)).toEqual([sha("var a=1"), sha('{"prefetch":[]}'), sha('import("/statik/y.js")')]);
  });

  it("hash + strict-dynamic + Trusted Types + object-src/base-uri none (Lighthouse csp-xss bulgusu yok)", () => {
    const csp = staticPageCsp(html);
    const script = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain(sha("var a=1"));
    // Eski tarayıcı yedekleri: hash/strict-dynamic bilen tarayıcı bunları yok sayar.
    expect(script).toContain("'unsafe-inline'");
    expect(script).toContain("https:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(staticPageCsp(html, { development: true })).not.toContain("upgrade-insecure-requests");
  });

  it("güvenlik başlıkları ETag başına sabit: CSP + COOP", () => {
    const h = staticSecurityHeaders("e1", html);
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Content-Security-Policy"]).toBe(staticPageCsp(html, { development: process.env.NODE_ENV === "development" }));
    expect(staticSecurityHeaders("e1", "<script>farklı</script>")).toBe(h);
  });

  it("katı politika yalnız dönüştürülmüş statik HTML'e (normal Next yedeğine değil)", () => {
    const src = readFileSync("src/lib/static-home/render.ts", "utf8");
    expect(src).toMatch(/if \(c\.isStatic\) for \(const \[k, v\] of Object\.entries\(staticSecurityHeaders\(c\.etag, c\.html\)\)\)/);
  });

  it("statik çalışma zamanı HTML yazıcısı kullanmaz (Trusted Types altında atar)", () => {
    const rt = readFileSync("src/static-home/runtime.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(rt).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/);
  });
});
