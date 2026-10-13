import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.fn(async (_input: { to: string; subject: string; text: string; html?: string }) => ({ ok: true as const, id: "x" }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSettingsMany: vi.fn(async () => ({})) }));

import { resolveEmailChannel } from "./provider";
import { getSettingDef } from "@/lib/settings/registry";

describe("e-posta kanalı çözüm sırası (env > panel > kapalı)", () => {
  const FROM = "EmlakSoft <bildirim@emlaksoft.com.tr>";

  it("env anahtarı ve göndereni paneldekinden önceliklidir", () => {
    const r = resolveEmailChannel(
      { RESEND_API_KEY: "re_env_key", EMAIL_FROM: FROM },
      { apiKey: "re_panel_key", from: "Panel <p@panel.com>", replyTo: null },
    );
    expect(r).toMatchObject({ enabled: true, apiKey: "re_env_key", keySource: "env", from: FROM, fromSource: "env" });
  });

  it("env yoksa panel değeri kullanılır", () => {
    const r = resolveEmailChannel({}, { apiKey: "re_panel_key", from: FROM, replyTo: "destek@emlaksoft.com.tr" });
    expect(r).toMatchObject({ enabled: true, apiKey: "re_panel_key", keySource: "panel", fromSource: "panel", replyTo: "destek@emlaksoft.com.tr" });
  });

  it("anahtar ve gönderen ayrı ayrı çözülür (env anahtar + panel gönderen)", () => {
    const r = resolveEmailChannel({ RESEND_API_KEY: "re_env" }, { apiKey: null, from: FROM, replyTo: null });
    expect(r).toMatchObject({ enabled: true, keySource: "env", fromSource: "panel" });
  });

  it("hiçbiri yoksa kanal kapalı ve nedeni açık", () => {
    const r = resolveEmailChannel({}, { apiKey: null, from: null, replyTo: null });
    expect(r.enabled).toBe(false);
    expect(r.keySource).toBe("none");
    expect(r.reason).toMatch(/tanımlı değil/);
  });

  it("panel anahtarı çözülemiyorsa kapalı ve neden PLATFORM_SECRETS_KEY'i söyler", () => {
    const r = resolveEmailChannel({}, { apiKey: null, apiKeyUndecryptable: true, from: FROM, replyTo: null });
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/çözülemiyor/);
  });

  it("geçersiz gönderen kanalı kapatır; geçersiz yanıt adresi yok sayılır", () => {
    expect(resolveEmailChannel({ RESEND_API_KEY: "re_x", EMAIL_FROM: "gecersiz" }, { apiKey: null, from: null, replyTo: null }).enabled).toBe(false);
    expect(resolveEmailChannel({ RESEND_API_KEY: "re_x", EMAIL_FROM: FROM }, { apiKey: null, from: null, replyTo: "x" }).replyTo).toBeNull();
  });

  it("ayar defterinde anahtar gizli, gönderen/yanıt gizli değil; gönderen biçimi doğrulanır", () => {
    expect(getSettingDef("email.resend_api_key")?.sensitivity).toBe("secret");
    const from = getSettingDef("email.from")!;
    expect(from.sensitivity).not.toBe("secret");
    expect(from.schema.safeParse("EmlakSoft <a@b.com>").success).toBe(true);
    expect(from.schema.safeParse("a@b.com").success).toBe(true);
    expect(from.schema.safeParse("EmlakSoft a@b").success).toBe(false);
    expect(getSettingDef("email.reply_to")?.schema.safeParse("x").success).toBe(false);
  });
});

describe("kendine test gönderimi yalnız oturumdaki personele", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
    vi.resetModules();
    vi.doMock("./provider", async (orig) => ({ ...(await orig<typeof import("./provider")>()), sendEmail: sendEmailMock }));
    // Günlük sarmalayıcısı (send.ts) DB'ye gitmesin: ortam yok gibi davran (günlük/bastırma atlanır).
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw new Error("test: admin yok");
      },
    }));
  });

  it("alıcı daima staff.email; şablon örneği [Örnek] önekli ve örnek veriyle", async () => {
    const { sendSelfEmail } = await import("./test-send");
    await sendSelfEmail({ email: "personel@emlaksoft.com.tr", full_name: "Ayşe" }, { type: "test" });
    await sendSelfEmail(
      { email: "personel@emlaksoft.com.tr" },
      { type: "template", key: "trial_ending", subject: "{ofis}: {gun} gün", body: "Merhaba {ofis}" },
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    for (const call of sendEmailMock.mock.calls) expect(call[0].to).toBe("personel@emlaksoft.com.tr");
    expect(sendEmailMock.mock.calls[1][0].subject).toBe("[Örnek] Örnek Emlak Ofisi: 3 gün");
  });

  it("personelin e-postası yoksa gönderim yok", async () => {
    const { sendSelfEmail } = await import("./test-send");
    const r = await sendSelfEmail({ email: "" }, { type: "test" });
    expect(r.ok).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("eylemler alıcı parametresi kabul etmez ve süper admin + dakikada 3 sınırlıdır", () => {
    const src = readFileSync("src/app/actions/platform-email.ts", "utf8");
    expect(src).toMatch(/export async function sendSelfTestEmailAction\(\)/);
    expect(src).toMatch(/export async function sendTemplateSampleAction\(templateKey: string\)/);
    expect(src).toMatch(/export async function testEmailConnectionAction\(\)/);
    expect(src).not.toMatch(/\bto\s*:/);
    expect(src).toContain('roles: ["super_admin"]');
    expect(src).toMatch(/limit: 3, windowSec: 60/);
  });
});
