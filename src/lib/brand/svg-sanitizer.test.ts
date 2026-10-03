import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateBrandSvg } from "./svg-sanitizer";

const MAX = 100 * 1024;
const wrap = (inner: string, attrs = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe("validateBrandSvg", () => {
  it("kabul eder: basit SVG, gradyan, iç referans, medya sorgulu style", () => {
    expect(validateBrandSvg(wrap('<rect width="10" height="10" fill="red"/>'), MAX).ok).toBe(true);
    expect(
      validateBrandSvg(
        wrap('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"/>'),
        MAX,
      ).ok,
    ).toBe(true);
    expect(validateBrandSvg(wrap("<style>.a{fill:url(#g)}@media (prefers-color-scheme:dark){.a{fill:#fff}}</style><rect class=\"a\"/>"), MAX).ok).toBe(true);
  });

  it("xml bildirimini atar ve eksik xmlns ekler", () => {
    const res = validateBrandSvg('<?xml version="1.0"?>\n<svg viewBox="0 0 4 4"><path d="M0 0"/></svg>', MAX);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.svg.startsWith("<svg xmlns=")).toBe(true);
      expect(res.svg).not.toContain("<?xml");
    }
  });

  it.each([
    ["script öğesi", wrap("<script>alert(1)</script>")],
    ["olay özniteliği", wrap('<rect onload="alert(1)" width="1" height="1"/>')],
    ["olay özniteliği (büyük harf)", wrap('<rect ONCLICK="x()" width="1" height="1"/>')],
    ["foreignObject", wrap("<foreignObject><div>x</div></foreignObject>")],
    ["dış href", wrap('<use href="https://evil.example/x.svg#a"/>')],
    ["xlink dış href", wrap('<use xlink:href="//evil.example/x.svg#a"/>')],
    ["javascript url", wrap('<a href="javascript:alert(1)"><rect/></a>')],
    ["image öğesi", wrap('<image href="data:image/png;base64,AAAA"/>')],
    ["style import", wrap("<style>@import url(https://evil.example/a.css);</style>")],
    ["style dış url", wrap("<style>.a{background:url(https://evil.example/p.png)}</style>")],
    ["öznitelikte dış url", wrap('<rect fill="url(https://evil.example/p)"/>')],
    ["data uri", wrap('<rect style="fill:url(data:image/svg+xml;base64,AAAA)"/>')],
    ["doctype/entity", `<!DOCTYPE svg [<!ENTITY x "y">]>${wrap("<rect/>")}`],
    ["cdata", wrap("<style><![CDATA[.a{fill:red}]]></style>")],
    ["iframe", wrap("<iframe src=\"x\"></iframe>")],
    ["karakter referansı ile gizli javascript", wrap('<a href="&#106;avascript:alert(1)"><rect/></a>')],
    ["svg değil", "<html><body>x</body></html>"],
    ["viewBox yok", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
    ["boş", ""],
  ])("reddeder: %s", (_name, input) => {
    expect(validateBrandSvg(input, MAX).ok).toBe(false);
  });

  it("boyut sınırını uygular", () => {
    const big = wrap(`<path d="${"M0 0".repeat(40_000)}"/>`);
    const res = validateBrandSvg(big, MAX);
    expect(res.ok).toBe(false);
  });

  it("depodaki tüm varsayılan marka SVG'leri kendi doğrulayıcımızdan geçer", () => {
    const files = readdirSync("public/brand").filter((f) => f.endsWith(".svg"));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const res = validateBrandSvg(readFileSync(`public/brand/${f}`, "utf8"), MAX);
      expect(res.ok, `${f}: ${res.ok ? "" : res.error}`).toBe(true);
    }
    expect(validateBrandSvg(readFileSync("public/icon.svg", "utf8"), MAX).ok).toBe(true);
  });
});
