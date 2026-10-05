import { describe, expect, it } from "vitest";
import {
  firstTouchAfter,
  formatMinutes,
  measureLead,
  summarizeByAdvisor,
  summarizeResponses,
  workingMinutesBetween,
} from "./core";

/** TR duvar saati (UTC+3) → epoch ms. 2026-03-02 Pazartesi. */
const tr = (day: number, h: number, m = 0) => Date.UTC(2026, 2, day, h - 3, m);

describe("workingMinutesBetween", () => {
  it("aynı gün çalışma saatinde düz fark", () => {
    expect(workingMinutesBetween(tr(2, 10), tr(2, 11, 30))).toBe(90);
  });
  it("mesai dışı gelen talep sabah 09:00'da başlar", () => {
    expect(workingMinutesBetween(tr(2, 22), tr(3, 9, 20))).toBe(20);
  });
  it("gün aşımı: akşam 18:30 -> ertesi sabah 09:15 = 30 + 15", () => {
    expect(workingMinutesBetween(tr(2, 18, 30), tr(3, 9, 15))).toBe(45);
  });
  it("pazar günü sayılmaz (Cmt 18:00 -> Pzt 09:30)", () => {
    expect(workingMinutesBetween(tr(7, 18), tr(9, 9, 30))).toBe(60 + 30);
  });
  it("geriye veya sıfır aralık 0", () => {
    expect(workingMinutesBetween(tr(2, 12), tr(2, 11))).toBe(0);
    expect(workingMinutesBetween(Number.NaN, tr(2, 11))).toBe(0);
  });
});

describe("measureLead", () => {
  const lead = { customerId: "c1", name: "Ali", assignedTo: "u1", createdAt: new Date(tr(2, 10)).toISOString() };
  it("kayıttan önceki temas sayılmaz, sonraki ilk temas alınır", () => {
    const touches = [
      { at: new Date(tr(2, 9)).toISOString(), kind: "comm" as const },
      { at: new Date(tr(2, 10, 45)).toISOString(), kind: "call" as const },
      { at: new Date(tr(2, 12)).toISOString(), kind: "comm" as const },
    ];
    expect(firstTouchAfter(lead.createdAt, touches)).toBe(new Date(tr(2, 10, 45)).toISOString());
    const m = measureLead(lead, touches, 60, tr(3, 12));
    expect(m).toMatchObject({ responded: true, minutes: 45, status: "hizli" });
  });
  it("eşik aşılırsa geç yanıtlandı", () => {
    const m = measureLead(lead, [{ at: new Date(tr(2, 13)).toISOString(), kind: "comm" }], 60, tr(3, 12));
    expect(m?.status).toBe("gecikti");
  });
  it("yanıtsız: eşik içinde bekliyor, aşınca bekliyor_gec", () => {
    expect(measureLead(lead, [], 60, tr(2, 10, 30))?.status).toBe("bekliyor");
    const late = measureLead(lead, [], 60, tr(2, 12));
    expect(late).toMatchObject({ responded: false, minutes: 120, status: "bekliyor_gec" });
  });
  it("bozuk tarih ölçülemez: null (0 sayılmaz)", () => {
    expect(measureLead({ ...lead, createdAt: "x" }, [], 60, tr(2, 12))).toBeNull();
  });
});

describe("summarize", () => {
  const mk = (id: string, who: string | null, created: number, touch: number | null, now = tr(3, 18)) =>
    measureLead(
      { customerId: id, name: id, assignedTo: who, createdAt: new Date(created).toISOString() },
      touch === null ? [] : [{ at: new Date(touch).toISOString(), kind: "comm" }],
      60,
      now,
    )!;
  it("yanıtlanan yoksa ortalama null (veri yok), 0 değil", () => {
    const s = summarizeResponses([mk("a", "u1", tr(3, 10), null)]);
    expect(s.avgMin).toBeNull();
    expect(s.withinSlaPct).toBeNull();
    expect(s.overdueWaiting).toBe(1);
    expect(formatMinutes(s.avgMin)).toBe("Veri yok");
  });
  it("ortalama, medyan ve yüzde", () => {
    const rows = [
      mk("a", "u1", tr(3, 10), tr(3, 10, 10)),
      mk("b", "u1", tr(3, 10), tr(3, 10, 30)),
      mk("c", "u1", tr(3, 10), tr(3, 13)),
    ];
    const s = summarizeResponses(rows);
    expect(s).toMatchObject({ total: 3, responded: 3, avgMin: 73, medianMin: 30, withinSlaPct: 67 });
  });
  it("danışman bazlı gruplama, atanmamış ayrı", () => {
    const g = summarizeByAdvisor([mk("a", "u1", tr(3, 10), null), mk("b", null, tr(3, 10), tr(3, 10, 5))]);
    expect(g.map((x) => x.advisorId)).toEqual(["u1", null]);
  });
  it("formatMinutes", () => {
    expect(formatMinutes(42)).toBe("42 dk");
    expect(formatMinutes(190)).toBe("3 sa 10 dk");
    expect(formatMinutes(120)).toBe("2 sa");
  });
});
