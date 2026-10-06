import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WHATSAPP_WINDOW_MS, whatsappWindowState, windowLabel } from "./whatsapp-window";

const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("WhatsApp 24 saat penceresi", () => {
  it("son gelen mesajdan 24 saat açık, sonra kapalı", () => {
    expect(whatsappWindowState("2026-10-07T02:00:00Z", NOW)).toMatchObject({ open: true, remainingMs: 14 * 3_600_000 });
    expect(whatsappWindowState(new Date(NOW - WHATSAPP_WINDOW_MS).toISOString(), NOW).open).toBe(false);
    expect(whatsappWindowState(null, NOW).open).toBe(false);
    expect(windowLabel(whatsappWindowState("2026-10-07T02:00:00Z", NOW))).toBe("Serbest yanıt penceresi: 14 sa 0 dk kaldı");
    expect(windowLabel({ open: false, remainingMs: 0, expiresAt: null })).toMatch(/şablon/);
  });

  it("sunucu pencereyi aynı numaranın SON gelen mesajına göre yeniden doğrular; serbest metin yalnız ofis entegrasyonuyla", () => {
    const action = readFileSync("src/app/actions/whatsapp-reply.ts", "utf8");
    expect(action).toContain('.eq("contact_address", msg.contact_address)');
    expect(action).toContain("templateRequired: true");
    const providers = readFileSync("src/lib/messaging/tenant-providers.ts", "utf8");
    const fn = providers.slice(providers.indexOf("export async function sendTenantWhatsAppSessionText"), providers.indexOf("export async function prepareTenantWhatsAppSender"));
    expect(fn).toContain("fetchExternal(");
    expect(fn).not.toContain("platformMessagingFallbackAllowed");
    expect(fn).toContain('type: "text"');
  });
});
