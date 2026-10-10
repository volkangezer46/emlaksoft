import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_TABS, splitNavTabs } from "./morph-tabs";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

describe("sekme şeridi taşması (5'ten fazla sekme)", () => {
  it("5 ve altında hepsi görünür, 'Diğer' yok", () => {
    expect(splitNavTabs(mk(MAX_VISIBLE_TABS), "t0").more).toEqual([]);
    expect(splitNavTabs(mk(3), null).shown).toHaveLength(3);
  });

  it("5'ten fazlasında ilk 5 görünür, kalanı menüde", () => {
    const r = splitNavTabs(mk(9), "t1");
    expect(r.shown.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(r.more.map((t) => t.id)).toEqual(["t5", "t6", "t7", "t8"]);
  });

  it("etkin sekme taşmaya düşerse şeritte son sıraya alınır; hiçbir sekme kaybolmaz", () => {
    const r = splitNavTabs(mk(9), "t7");
    expect(r.shown.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3", "t7"]);
    expect([...r.shown, ...r.more].map((t) => t.id).sort()).toEqual(mk(9).map((t) => t.id).sort());
  });
});
