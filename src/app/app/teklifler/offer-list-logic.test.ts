import { describe, expect, it } from "vitest";
import { OFFER_STATUS_LABELS, offerStatusTone, offerTableValue, offerVolume } from "./offer-list-logic";

describe("teklif liste mantığı", () => {
  it("her durumun etiketi ve tonu var, kabul=success red=danger", () => {
    for (const key of Object.keys(OFFER_STATUS_LABELS)) expect(offerStatusTone(key)).toBeTruthy();
    expect(offerStatusTone("accepted")).toBe("success");
    expect(offerStatusTone("rejected")).toBe("danger");
    expect(offerStatusTone("countered")).toBe("warning");
    expect(offerStatusTone("bilinmeyen")).toBe("neutral");
  });
  it("masadaki rakam karşı tekliftir", () => {
    expect(offerTableValue({ amount: 100, counter: 120 })).toBe(120);
    expect(offerTableValue({ amount: 100, counter: null })).toBe(100);
    expect(offerTableValue({ amount: null, counter: null })).toBe(0);
  });
  it("hacim: tarama tavana dayanırsa null (uydurma toplam yok)", () => {
    const rows = [
      { amount: 100, counter: null },
      { amount: 100, counter: 150 },
    ];
    expect(offerVolume(rows, 1000)).toBe(250);
    expect(offerVolume(rows, 2)).toBeNull();
  });
});
