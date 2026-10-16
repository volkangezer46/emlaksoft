import { describe, expect, it } from "vitest";
import { buildMultiMatchMessage, matchFitLabel } from "./match-send-message";

describe("Uygun ilanlar: tek WhatsApp iletisi (C14)", () => {
  it("birden çok ilanı numaralı ve bağlantılı tek mesajda toplar", () => {
    const msg = buildMultiMatchMessage({
      customerName: "Ayşe Kaya",
      items: [
        { title: "Kadıköy 3+1", listPrice: 4_500_000, url: "https://x/paylas/a" },
        { title: "Moda 2+1", listPrice: null, url: "https://x/paylas/b" },
      ],
      advisorName: "Ali",
      officeName: "Demo Ofis",
    });
    expect(msg.startsWith("Merhaba Ayşe,")).toBe(true);
    expect(msg).toContain("2 ilanı");
    expect(msg).toContain("1) Kadıköy 3+1 (");
    expect(msg).toContain("2) Moda 2+1\nhttps://x/paylas/b");
    expect(msg.trim().endsWith("Ali · Demo Ofis")).toBe(true);
    expect(msg.toLocaleLowerCase("tr-TR")).not.toContain("sunum");
  });

  it("tek ilanda numara yok", () => {
    const msg = buildMultiMatchMessage({ customerName: null, items: [{ title: "Daire", listPrice: 0, url: "u" }] });
    expect(msg).toContain("bir ilanı");
    expect(msg).not.toContain("1)");
  });

  it("puan yerine sade uyum etiketi", () => {
    expect(matchFitLabel("strong")).toBe("Çok uygun");
    expect(matchFitLabel("good")).toBe("Uygun");
    expect(matchFitLabel("weak")).toBe("Uygun");
  });
});
