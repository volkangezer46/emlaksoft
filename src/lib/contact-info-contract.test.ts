import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";

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
});

describe("destek iletişimi env sözleşmesi", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("varsayılan destek@emlaksoft.com.tr; telefon/WhatsApp tanımsızsa null (hiçbir yerde görünmez)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_PHONE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP", "");
    vi.resetModules();
    const m = await import("./contact-info");
    expect(m.SUPPORT_EMAIL).toBe("destek@emlaksoft.com.tr");
    expect(m.SUPPORT_MAILTO).toBe("mailto:destek@emlaksoft.com.tr");
    expect([m.SUPPORT_PHONE, m.SUPPORT_TEL, m.SUPPORT_WHATSAPP, m.SUPPORT_WHATSAPP_URL]).toEqual([null, null, null, null]);
  });

  it("env tanımlıysa öncelikli; WhatsApp bağlantısı uluslararası biçimde", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "yardim@ornek.com.tr");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_PHONE", "0850 000 00 00");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP", "0532 000 00 00");
    vi.resetModules();
    const m = await import("./contact-info");
    expect(m.SUPPORT_EMAIL).toBe("yardim@ornek.com.tr");
    expect(m.SUPPORT_TEL).toBe("tel:08500000000");
    expect(m.SUPPORT_WHATSAPP_URL).toBe("https://wa.me/905320000000");
  });
});
