import { describe, expect, it } from "vitest";
import { propertyNextAction } from "./next-action";

describe("propertyNextAction", () => {
  it("teşhis engeli varsa ilgili sekmeye götürür", () => {
    expect(propertyNextAction({ propertyId: "p", status: "live", blockerKey: "photos_few", blockerTab: "medya" })).toEqual({
      href: "/app/portfoyler/p?sekme=medya",
      label: "Düzeltmeye git",
      hint: null,
    });
  });
  it("taslak portföy yayın hazırlığına (ilan sahibi sekmesi) gider", () => {
    const a = propertyNextAction({ propertyId: "p", status: "draft", blockerKey: null, blockerTab: null });
    expect(a.href).toBe("/app/portfoyler/p?sekme=sahip");
    expect(a.label).toBe("Yayına hazırla");
    expect(a.hint).toMatch(/Yayında/);
  });
  it("kapanmış, rezerve ve arşiv durumları kendi adımını verir", () => {
    expect(propertyNextAction({ propertyId: "p", status: "sold", blockerKey: null, blockerTab: null }).href).toBe("/app/portfoyler/p?sekme=ozet");
    expect(propertyNextAction({ propertyId: "p", status: "reserved", blockerKey: null, blockerTab: null }).label).toBe("Anlaşmaya git");
    expect(propertyNextAction({ propertyId: "p", status: "archived", blockerKey: null, blockerTab: null }).href).toBe("/app/portfoyler/p?sekme=ozet#durum");
  });
  it("yayında ve engelsiz portföy portal kayıtlarına gider (yazım: Portalları)", () => {
    expect(propertyNextAction({ propertyId: "p", status: "live", blockerKey: null, blockerTab: null })).toEqual({
      href: "/app/portfoyler/p?sekme=portallar",
      label: "Portalları gör",
      hint: null,
    });
  });
});
