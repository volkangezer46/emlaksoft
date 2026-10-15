import { describe, expect, it } from "vitest";
import { appointmentAlarmMinutes, escapeICS, foldICSLine, icsEventLines } from "@/lib/calendar/ics-feed";
import { generateICS } from "@/lib/calendar";

const enc = new TextEncoder();

describe("ICS (GA-06)", () => {
  it("TEXT kaçışı", () => {
    expect(escapeICS("a;b,c\\d\ne")).toBe("a\;b\\,c\\\\d\\ne");
  });

  it("75 oktet katlama: Türkçe çok baytlı karakter bölünmez, devam satırı boşlukla", () => {
    const long = `SUMMARY:${"Ğ".repeat(60)}`;
    const folded = foldICSLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(enc.encode(p).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(" ")).toBe(true);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
    expect(foldICSLine("SUMMARY:kısa")).toBe("SUMMARY:kısa");
  });

  it("VEVENT: VALARM, GEO ve URL", () => {
    const lines = icsEventLines({
      uid: "a1@emlaksoft",
      dtstamp: new Date("2026-10-15T09:00:00Z"),
      start: new Date("2026-10-16T08:00:00Z"),
      end: new Date("2026-10-16T09:00:00Z"),
      summary: "Yer gösterme — Ayşe",
      location: "Kadıköy",
      geo: { lat: 40.99, lng: 29.03 },
      url: "https://app.test/app/randevular?randevu=a1",
      status: "CONFIRMED",
      alarmMinutes: appointmentAlarmMinutes(true),
    });
    const text = lines.join("\r\n");
    expect(text).toContain("GEO:40.99;29.03");
    expect(text).toContain("URL:https://app.test/app/randevular?randevu=a1");
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(text).toContain("TRIGGER:-PT60M");
    expect(text).toContain("TRIGGER:-PT30M");
    expect(lines[0]).toBe("BEGIN:VEVENT");
    expect(lines.at(-1)).toBe("END:VEVENT");
    expect(appointmentAlarmMinutes(false)).toEqual([30]);
  });

  it("generateICS varsayılan 30 dk alarm taşır", () => {
    const ics = generateICS({ uid: "x", title: "Randevu", startAt: new Date("2026-10-16T08:00:00Z") });
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(generateICS({ uid: "x", title: "R", startAt: new Date(), alarmMinutes: [] })).not.toContain("VALARM");
  });
});
