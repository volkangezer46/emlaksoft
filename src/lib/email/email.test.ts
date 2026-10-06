import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EMAIL_TEMPLATES, renderTemplate, templateSettingKey } from "./templates";
import { emailChannelStatus, sendEmail } from "./provider";
import { getSettingDef } from "@/lib/settings/registry";

describe("e-posta kanalı", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("anahtar yoksa kapalı ve gönderim istek atmadan no-op", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailChannelStatus().enabled).toBe(false);
    const res = await sendEmail({ to: "a@b.com", subject: "x", text: "y" });
    expect(res).toMatchObject({ ok: false, code: "disabled" });
  });

  it("şablon: değişken düz metin yerleşir, bilinmeyen kalır, konu tek satır", () => {
    expect(renderTemplate("{ofis}: {gun} gün {yok}", { ofis: "A", gun: 3 })).toBe("A: 3 gün {yok}");
    expect(renderTemplate("{ofis}", { ofis: "a\nb" }, { singleLine: true })).toBe("a b");
  });

  it("her şablonun konu/gövdesi ayar defterinde ve varsayılan kodla aynı", () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(getSettingDef(templateSettingKey(t.key, "subject"))?.default).toBe(t.defaultSubject);
      expect(getSettingDef(templateSettingKey(t.key, "body"))?.default).toBe(t.defaultBody);
    }
  });

  it("tek adaptör fetchExternal; doğrudan fetch yok", () => {
    const src = readFileSync("src/lib/email/provider.ts", "utf8");
    expect(src).toContain("fetchExternal(");
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
