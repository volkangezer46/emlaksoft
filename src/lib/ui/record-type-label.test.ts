import { describe, expect, it } from "vitest";
import { recordTypeLabel } from "./record-type-label";

describe("ayrıntı sayfası kayıt türü", () => {
  it("liste yolundan tekil ad; bilinmeyende 'Ayrıntı'", () => {
    expect(recordTypeLabel("/app/musteriler")).toBe("Müşteri");
    expect(recordTypeLabel("/app/portfoyler?sekme=x")).toBe("Portföy");
    expect(recordTypeLabel("/app/kiralama")).toBe("Kira sözleşmesi");
    expect(recordTypeLabel("/app/bilinmeyen")).toBe("Ayrıntı");
  });
});
