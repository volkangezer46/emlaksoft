import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";
import { buildSupportContact, DEFAULT_SUPPORT_EMAIL } from "./contact-info";
import { resolveSupportContact } from "./contact-info-server";

/** Destek e-postası TEK kaynak: kaynakta sabit 'destek@emlaksoft' dizesi yalnız contact-info.ts'te geçer. */
describe("destek e-postası tek kaynak", () => {
  it("destek@emlaksoft yalnız contact-info.ts içinde", () => {
    const offenders: string[] = [];
    for (const file of walkSource(path.join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const norm = file.replace(/\\/g, "/");
      if (norm.endsWith("/lib/contact-info.ts") || /\.test\.tsx?$/.test(norm)) continue;
      if (readCached(file).includes("destek@emlaksoft")) offenders.push(norm);
    }
    expect(offenders).toEqual([]);
  });

  it("yasal sayfalar ve askı ekranı iletişimi ayardan okur (NEXT_PUBLIC_SUPPORT_* bağımlılığı yok)", () => {
    for (const rel of [
      "src/components/legal-page.tsx",
      "src/app/mesafeli-satis/page.tsx",
      "src/app/on-bilgilendirme/page.tsx",
      "src/app/gizlilik/page.tsx",
      "src/app/kvkk-aydinlatma/page.tsx",
      "src/app/iptal-iade/page.tsx",
      "src/app/app/askida/page.tsx",
    ]) {
      const src = readCached(path.join(process.cwd(), rel));
      expect(src, rel).toContain("getSupportContact()");
      expect(src, rel).not.toMatch(/SUPPORT_(EMAIL|MAILTO|PHONE|TEL|WHATSAPP)\b/);
    }
  });
});

describe("destek iletişimi çözümü (ayar > sunucu env > varsayılan)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ayar ve env yoksa varsayılan e-posta; telefon/WhatsApp null (hiçbir yerde görünmez)", () => {
    for (const k of ["SUPPORT_EMAIL", "SUPPORT_PHONE", "SUPPORT_WHATSAPP", "NEXT_PUBLIC_SUPPORT_PHONE", "NEXT_PUBLIC_SUPPORT_WHATSAPP"]) vi.stubEnv(k, "");
    const c = resolveSupportContact({});
    expect(c.email).toBe(DEFAULT_SUPPORT_EMAIL);
    expect(c.mailto).toBe(`mailto:${DEFAULT_SUPPORT_EMAIL}`);
    expect([c.phone, c.tel, c.whatsapp, c.whatsappUrl]).toEqual([null, null, null, null]);
  });

  it("ayar env'den önce gelir; boş ayar env yedeğine düşer", () => {
    vi.stubEnv("SUPPORT_EMAIL", "env@ornek.com.tr");
    vi.stubEnv("SUPPORT_PHONE", "0850 111 11 11");
    expect(resolveSupportContact({ "support.email": "yardim@ornek.com.tr" }).email).toBe("yardim@ornek.com.tr");
    expect(resolveSupportContact({ "support.email": "  " }).email).toBe("env@ornek.com.tr");
    expect(resolveSupportContact({}).tel).toBe("tel:08501111111");
  });

  it("bağlantı biçimleri: tel rakam, WhatsApp uluslararası", () => {
    const c = buildSupportContact({ email: "a@b.co", phone: "0850 000 00 00", whatsapp: "0532 000 00 00" });
    expect(c.tel).toBe("tel:08500000000");
    expect(c.whatsappUrl).toBe("https://wa.me/905320000000");
    expect(buildSupportContact({ whatsapp: "+49 151 2345 6789" }).whatsappUrl).toBe("https://wa.me/4915123456789");
  });
});
