import { describe, expect, it } from "vitest";
import { buildShareHref, buildShareMessage, whatsappShareGate } from "./whatsapp-share";

describe("whatsappShareGate", () => {
  it("işlem amaçlı (değerleme) iletide İYS aranmaz", () => {
    expect(whatsappShareGate({ purpose: "transactional", recipientKnown: true, consent: null })).toEqual({ allowed: true, note: null });
  });
  it("ticari iletide alıcı belliyse yalnız 'granted' geçer", () => {
    expect(whatsappShareGate({ purpose: "commercial", recipientKnown: true, consent: "granted" })).toEqual({ allowed: true, note: null });
    for (const c of ["denied", "unknown", "pending", null] as const) {
      expect(whatsappShareGate({ purpose: "commercial", recipientKnown: true, consent: c }).allowed).toBe(false);
    }
  });
  it("ticari iletide alıcı belirsizse geçer ama uyarı notu taşır", () => {
    const g = whatsappShareGate({ purpose: "commercial", recipientKnown: false, consent: null });
    expect(g.allowed).toBe(true);
    expect(g).toMatchObject({ note: expect.stringContaining("İYS") });
  });
});

describe("mesaj ve bağlantı", () => {
  it("mesaj tek bağlantı taşır, ilk ad kullanılır", () => {
    const m = buildShareMessage({ kind: "valuation", officeName: "Demo Emlak", recipientName: "Ayşe Yılmaz", title: "Daire", url: "https://x.test/degerleme-raporu/t" });
    expect(m).toContain("Merhaba Ayşe,");
    expect(m).toContain("https://x.test/degerleme-raporu/t");
    expect(buildShareMessage({ kind: "presentation", officeName: null, recipientName: null, title: null, url: "https://x.test/s" })).toContain("Merhaba,");
  });
  it("kayıtlı cep telefonu varsa doğrudan wa.me/90…, yoksa alıcı seçtiren bağlantı", () => {
    expect(buildShareHref("05321234567", "Merhaba").href).toMatch(/^https:\/\/wa\.me\/905321234567\?text=/);
    expect(buildShareHref("05321234567", "Merhaba").direct).toBe(true);
    const none = buildShareHref(null, "Merhaba");
    expect(none.direct).toBe(false);
    expect(none.href).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
});
