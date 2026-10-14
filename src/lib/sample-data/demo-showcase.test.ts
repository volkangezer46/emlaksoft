import { describe, expect, it } from "vitest";
import { PROPERTY_DESCRIPTION_MAX, parsePropertyDescription } from "@/lib/property-description";
import { parsePhoneStrict } from "@/lib/phone-rules";
import {
  DEMO_CLOSED_TIMELINE,
  DEMO_OFFICE_PHONE,
  DEMO_STAFF_PHONES,
  closedTimeline,
  demoDescription,
  demoSceneSvg,
  demoScenesFor,
} from "./demo-showcase";

const NOW = Date.parse("2026-10-14T09:00:00Z");

describe("demo vitrin zenginleştirmesi (YD1)", () => {
  it("açıklama: mahalle + metrekare içerir, sınır içinde ve açıklama kuralından geçer", () => {
    const text = demoDescription({
      code: "DEMO-001",
      title: "Kadıköy Moda'da deniz manzaralı 3+1",
      tx: "Satılık",
      type: "Daire",
      rooms: "3+1",
      m2: 145,
      floor: 4,
      heating: "Kombi (Doğalgaz)",
      age: 12,
      district: "kadikoy",
    });
    expect(text).toContain("Kadıköy Caferağa Mahallesi");
    expect(text).toContain("145 m²");
    expect(text.length).toBeLessThan(PROPERTY_DESCRIPTION_MAX);
    expect(parsePropertyDescription(text)).toEqual({ ok: true, value: text });
    const land = demoDescription({ code: "DEMO-011", title: "Arsa", tx: "Satılık", type: "Arsa", rooms: "-", m2: 540, district: "uskudar" });
    expect(land).toContain("Beylerbeyi");
    expect(land).not.toContain("undefined");
  });

  it("kapanmış portföyler geçmiş tarihli: kayıt < yayın < kapanış ≤ şimdi", () => {
    for (const code of Object.keys(DEMO_CLOSED_TIMELINE)) {
      const t = closedTimeline(code, NOW)!;
      expect(Date.parse(t.createdAt)).toBeLessThan(Date.parse(t.publishedAt));
      expect(Date.parse(t.publishedAt)).toBeLessThan(Date.parse(t.closedAt));
      expect(Date.parse(t.closedAt)).toBeLessThanOrEqual(NOW);
    }
    expect(closedTimeline("DEMO-001", NOW)).toBeNull();
  });

  it("telefonlar saklama biçiminde ve geçerli", () => {
    for (const phone of [...Object.values(DEMO_STAFF_PHONES), DEMO_OFFICE_PHONE]) {
      const parsed = parsePhoneStrict(phone);
      expect(parsed.ok, phone).toBe(true);
      if (parsed.ok) expect(parsed.stored).toBe(phone);
    }
  });

  it("örnek görsel: türüne göre sahne, deterministik SVG, 'Örnek görsel' etiketi", () => {
    expect(demoScenesFor("Daire")[0]).toBe("exterior");
    expect(demoScenesFor("Arsa")).toEqual(["land", "view"]);
    const a = demoSceneSvg("living", "DEMO-001");
    expect(a).toBe(demoSceneSvg("living", "DEMO-001"));
    expect(a).toContain("Örnek görsel");
    expect(a.startsWith("<svg")).toBe(true);
  });
});
