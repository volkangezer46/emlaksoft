import { describe, expect, it } from "vitest";
import {
  countByCategory,
  dayHeading,
  filterByCategory,
  groupEventsByDay,
  pageEvents,
  resolveCategory,
  sortEventsDesc,
  type TimelineEvent,
} from "./activity-timeline";

const ev = (id: string, at: string, category = "gorusme"): TimelineEvent => ({ id, at, category, title: id });

describe("activity-timeline", () => {
  it("gün başlığı TR büyük harf", () => {
    expect(dayHeading("2026-10-03T10:00:00Z")).toBe("3 EKİ 2026");
    expect(dayHeading("2026-02-01T10:00:00Z")).toBe("1 ŞUB 2026");
    expect(dayHeading("2026-08-09T10:00:00Z")).toBe("9 AĞU 2026");
  });

  it("TR gün sınırı: 20:59Z aynı gün, 21:00Z ertesi TR günü", () => {
    const g = groupEventsByDay([ev("a", "2026-10-03T20:59:00Z"), ev("b", "2026-10-03T21:00:00Z")]);
    expect(g).toHaveLength(2);
    expect(g[0].heading).toBe("4 EKİ 2026");
    expect(g[0].events.map((e) => e.id)).toEqual(["b"]);
    expect(g[1].heading).toBe("3 EKİ 2026");
  });

  it("aynı günü birleştirir, yeniden eskiye sıralar, geçersiz tarihi atlar", () => {
    const g = groupEventsByDay([
      ev("a", "2026-10-03T08:00:00Z"),
      ev("c", "not-a-date"),
      ev("b", "2026-10-03T12:00:00Z"),
      ev("d", "2026-10-01T12:00:00Z"),
    ]);
    expect(g.map((x) => x.dayKey)).toEqual(["2026-10-03", "2026-10-01"]);
    expect(g[0].events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("süzgeç ve sayım", () => {
    const list = [ev("a", "2026-10-03T08:00:00Z", "randevu"), ev("b", "2026-10-03T09:00:00Z", "teklif")];
    expect(filterByCategory(list, "randevu").map((e) => e.id)).toEqual(["a"]);
    expect(filterByCategory(list, "").length).toBe(2);
    expect(filterByCategory(list, "all").length).toBe(2);
    expect(countByCategory(list)).toEqual({ randevu: 1, teklif: 1 });
  });

  it("sayfalama", () => {
    const list = [1, 2, 3].map((n) => ev(`e${n}`, `2026-10-0${n}T08:00:00Z`));
    const p = pageEvents(list, 2);
    expect(p.hasMore).toBe(true);
    expect(p.visible.map((e) => e.id)).toEqual(["e3", "e2"]);
    expect(pageEvents(list).hasMore).toBe(false);
    expect(sortEventsDesc(list)[0].id).toBe("e3");
  });

  it("kategori çözümleme", () => {
    expect(resolveCategory("teklif", ["teklif"])).toBe("teklif");
    expect(resolveCategory(["teklif"], ["teklif"])).toBe("teklif");
    expect(resolveCategory("x", ["teklif"])).toBe("");
    expect(resolveCategory(undefined, ["teklif"])).toBe("");
  });
});
