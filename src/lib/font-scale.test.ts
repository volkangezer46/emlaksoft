import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALES,
  fontScaleCss,
  isFontScale,
  parseFontCookie,
  parseFontScale,
  resolveFontScale,
  serializeFontCookie,
} from "./font-scale";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const UID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("font-scale (saf yardımcılar)", () => {
  it("varsayılan Normal; seçenekler Küçük/Normal/Büyük", () => {
    expect(DEFAULT_FONT_SCALE).toBe("md");
    expect(FONT_SCALES.map((f) => f.label)).toEqual(["Küçük", "Normal", "Büyük"]);
    expect(FONT_SCALES.map((f) => f.percent)).toEqual([90, 100, 112.5]);
  });

  it("geçersiz değer Normal'e düşer", () => {
    for (const bad of [undefined, null, "", "xl", "LG", 3, {}, "large", "normal"]) {
      expect(parseFontScale(bad)).toBe("md");
      expect(isFontScale(bad)).toBe(false);
    }
    for (const ok of ["sm", "md", "lg"]) expect(parseFontScale(ok)).toBe(ok);
  });

  it("çerez kullanıcıya bağlıdır: başka hesabın çerezi yok sayılır", () => {
    const raw = serializeFontCookie(UID, "lg");
    expect(parseFontCookie(raw, UID)).toBe("lg");
    expect(parseFontCookie(raw, "11111111-2222-3333-4444-555555555555")).toBeNull();
    expect(parseFontCookie(raw, null)).toBeNull();
    expect(parseFontCookie("lg", UID)).toBeNull();
    expect(parseFontCookie(`${UID}.zzz`, UID)).toBeNull();
  });

  it("çözümleme: çerez > metadata > Normal; oturum yoksa her zaman Normal", () => {
    expect(resolveFontScale({ userId: UID, cookieValue: serializeFontCookie(UID, "sm"), metadataValue: "lg" })).toBe("sm");
    expect(resolveFontScale({ userId: UID, cookieValue: serializeFontCookie("baska-kullanici-1", "sm"), metadataValue: "lg" })).toBe("lg");
    expect(resolveFontScale({ userId: UID, metadataValue: "bozuk" })).toBe("md");
    expect(resolveFontScale({ userId: UID })).toBe("md");
    expect(resolveFontScale({ userId: null, cookieValue: serializeFontCookie(UID, "lg"), metadataValue: "lg" })).toBe("md");
  });

  it("SSR stili: Normal'de boş, diğerlerinde yalnız öznitelik yokken geçerli", () => {
    expect(fontScaleCss("md")).toBe("");
    expect(fontScaleCss("sm")).toBe("html:not([data-font-size]){font-size:90%}");
    expect(fontScaleCss("lg")).toBe("html:not([data-font-size]){font-size:112.5%}");
  });
});

describe("yazı boyutu + kayma sözleşmesi (kaynak taraması)", () => {
  const consoleCss = read("src/app/console.css");

  it("console.css yüzdeleri FONT_SCALES ile senkron", () => {
    for (const f of FONT_SCALES) {
      expect(consoleCss).toContain(`html[data-font-size="${f.value}"] { font-size: ${f.percent}%; }`);
    }
  });

  it("public yüzey etkilenmez: öznitelik yalnız kabuk layout'larında ve yalnız console.css'te", () => {
    expect(read("src/app/layout.tsx")).not.toContain("data-font-size");
    expect(read("src/lib/theme.ts")).not.toContain("font-size");
    expect(read("src/app/globals.css")).not.toContain("data-font-size");
    expect(read("src/app/app/layout.tsx")).toContain("<FontScaleBoot");
    expect(read("src/app/admin/layout.tsx")).toContain("<FontScaleBoot");
    expect(read("src/components/font-scale-controller.tsx")).toContain("clearFontScale");
  });

  it("kabukta scrollbar-gutter kurali ve kaydirma kilidi telafisi sifirlama var", () => {
    expect(consoleCss).toMatch(/html:has\(\.shell-aside\)\s*\{\s*scrollbar-gutter:\s*stable;/);
    expect(consoleCss).toMatch(/body\[data-scroll-locked\]\s*\{[^}]*margin-right:\s*0 !important;[^}]*padding-right:\s*0 !important;/);
  });

  it("DropdownMenu varsayılan modal DEĞİL; kullanıcı menüsü modal/kaydırma kilidi kullanmaz", () => {
    expect(read("src/components/ui/dropdown-menu.tsx")).toContain("modal = false");
    for (const f of ["user-menu.tsx", "user-menu-panel.tsx", "view-prefs.tsx"]) {
      const src = read(`src/components/ui/console/${f}`);
      expect(src).not.toMatch(/modal=\{?true/);
      expect(src).not.toMatch(/overflow\s*=\s*["']hidden|body\.style|scrollIntoView|react-remove-scroll/);
    }
  });

  it("action: oturum kapısı, beyaz liste, hız sınırı; service_role ve metadata dışı yazma yok", () => {
    const src = read("src/app/actions/font-scale.ts");
    expect(src.startsWith('"use server"')).toBe(true);
    expect(src).toContain("getRequestUser");
    expect(src).toContain("isFontScale(value)");
    expect(src).toContain("checkRateLimit");
    expect(src).not.toContain("createAdminClient");
    // 'use server' dosyası yalnız async fonksiyon export eder (tip export'u serbest).
    const exports = src.match(/^export (?!type\b)(.*)$/gm) ?? [];
    expect(exports.every((l) => l.startsWith("export async function"))).toBe(true);
  });
});
