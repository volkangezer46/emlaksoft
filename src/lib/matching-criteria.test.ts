import { describe, expect, it } from "vitest";
import {
  explainMatch,
  scoreDemandProperty,
  type MatchDemand,
  type MatchProperty,
} from "./matching";

const demand = (over: Partial<MatchDemand> = {}): MatchDemand => ({
  id: "d1",
  transaction_type: "Satılık",
  property_type: "Daire",
  province_id: "aaaaaaaa-0001",
  district_id: "bbbbbbbb-0001",
  budget_min: 4_000_000,
  budget_max: 6_000_000,
  rooms: "3+1",
  min_sqm: 100,
  urgency: "normal",
  status: "active",
  ...over,
});

const property = (over: Partial<MatchProperty> = {}): MatchProperty => ({
  id: "pr1",
  property_code: "ES-1",
  title: "Test",
  transaction_type: "Satılık",
  property_type: "Daire",
  status: "live",
  list_price: 5_000_000,
  province_id: "aaaaaaaa-0001",
  district_id: "bbbbbbbb-0001",
  neighborhood_id: "cccccccc-0001",
  features: { rooms: "3+1", sqm: 120, floor: 3, heating: "Kombi (Doğalgaz)", facade: "Güney" },
  ...over,
});

describe("scoreDemandProperty: geriye uyum", () => {
  it("criteria yok / boş / bozuk: skor aynı, elenmez", () => {
    const a = scoreDemandProperty(demand(), property());
    const b = scoreDemandProperty(demand({ criteria: {} }), property());
    const c = scoreDemandProperty(demand({ criteria: "bozuk" }), property());
    expect(b.score).toBe(a.score);
    expect(c.score).toBe(a.score);
    expect(a.eliminated).toBe(false);
    expect(a.eliminatedBy).toEqual([]);
    expect(a.score).toBeGreaterThanOrEqual(75);
  });

  it("tercih (olmazsa olmaz değil) kriterler skoru değiştirmez", () => {
    const base = scoreDemandProperty(demand(), property());
    const pref = scoreDemandProperty(
      demand({ criteria: { heating: "Merkezi", facade: "Kuzey", floor_min: 10, features: ["Asansör"] } }),
      property(),
    );
    expect(pref.score).toBe(base.score);
    expect(pref.eliminated).toBe(false);
    expect(pref.reasons.find((r) => r.label === "Isınma")?.ok).toBe(false);
  });
});

describe("olmazsa olmaz süzgeci", () => {
  it("tutmayan zorunlu ısınma eşleşmeyi eler (skor <= 20)", () => {
    const r = scoreDemandProperty(demand({ criteria: { heating: "Merkezi", required: ["heating"] } }), property());
    expect(r.eliminated).toBe(true);
    expect(r.eliminatedBy).toEqual(["Isınma"]);
    expect(r.score).toBeLessThanOrEqual(20);
    expect(r.tier).toBe("none");
  });

  it("tutan zorunlu kriter elemez", () => {
    const r = scoreDemandProperty(
      demand({ criteria: { heating: "kombi (doğalgaz)", facade: "Güney", required: ["heating", "facade"] } }),
      property(),
    );
    expect(r.eliminated).toBe(false);
  });

  it("portföyde verisi olmayan alan elemez, belirsiz sayılır", () => {
    const r = scoreDemandProperty(
      demand({ criteria: { facade: "Kuzey", required: ["facade"] } }),
      property({ features: { rooms: "3+1", sqm: 120 } }),
    );
    expect(r.eliminated).toBe(false);
    expect(explainMatch(r).unknown).toContain("Cephe");
  });

  it("zorunlu bütçe: ±%10 esnekliği yok", () => {
    const soft = demand({ budget_max: 5_000_000 });
    const p = property({ list_price: 5_400_000 });
    expect(scoreDemandProperty(soft, p).eliminated).toBe(false);
    const strict = scoreDemandProperty({ ...soft, criteria: { required: ["budget"] } }, p);
    expect(strict.eliminated).toBe(true);
    expect(strict.eliminatedBy).toEqual(["Bütçe"]);
  });

  it("zorunlu oda ve m²", () => {
    const r = scoreDemandProperty(
      demand({ criteria: { required: ["rooms", "sqm"] } }),
      property({ features: { rooms: "2+1", sqm: 80 } }),
    );
    expect(r.eliminated).toBe(true);
    expect([...r.eliminatedBy].sort()).toEqual(["Oda", "m²"].sort());
  });

  it("zorunlu kat aralığı ve m² üst sınır", () => {
    const d = demand({ criteria: { floor_min: 5, max_sqm: 100, required: ["floor", "sqm"] } });
    const r = scoreDemandProperty(d, property());
    expect(r.eliminated).toBe(true);
    expect(r.eliminatedBy).toEqual(expect.arrayContaining(["Kat", "m²"]));
  });

  it("zorunlu özellik etiketi: portföyde etiket varsa eksik olan eler", () => {
    const d = demand({ criteria: { features: ["Asansör", "Otopark"], required: ["features"] } });
    const bad = scoreDemandProperty(d, property({ features: { rooms: "3+1", sqm: 120, tags: ["Asansör"] } }));
    expect(bad.eliminated).toBe(true);
    const good = scoreDemandProperty(d, property({ features: { rooms: "3+1", sqm: 120, tags: ["asansör", "OTOPARK"] } }));
    expect(good.eliminated).toBe(false);
  });
});

describe("çoklu bölge", () => {
  it("ek bölgelerden biri uyuyorsa konum tam puan alır", () => {
    const d = demand({ district_id: "bbbbbbbb-0002" });
    const single = scoreDemandProperty(d, property({ status: "reserved", features: { rooms: "2+1", sqm: 120 } }));
    const multi = scoreDemandProperty(
      { ...d, criteria: { extra_locations: [{ province_id: "aaaaaaaa-0001", district_id: "bbbbbbbb-0001", neighborhood_id: null }] } },
      property({ status: "reserved", features: { rooms: "2+1", sqm: 120 } }),
    );
    expect(multi.score).toBeGreaterThan(single.score);
  });

  it("zorunlu konum: hiçbir bölge uymazsa elenir", () => {
    const r = scoreDemandProperty(
      demand({
        district_id: "bbbbbbbb-0002",
        criteria: {
          required: ["location"],
          extra_locations: [{ province_id: "aaaaaaaa-0001", district_id: "bbbbbbbb-0003", neighborhood_id: null }],
        },
      }),
      property(),
    );
    expect(r.eliminated).toBe(true);
    expect(r.eliminatedBy).toEqual(["Konum"]);
  });

  it("mahalle seçildiyse farklı mahalle zorunlu konumda eler", () => {
    const r = scoreDemandProperty(demand({ neighborhood_id: "cccccccc-0002", criteria: { required: ["location"] } }), property());
    expect(r.eliminated).toBe(true);
  });
});

describe("explainMatch", () => {
  it("uyuşan / uyuşmayan / zorunlu işaretini alan bazlı verir", () => {
    const r = scoreDemandProperty(
      demand({ criteria: { heating: "Merkezi", required: ["heating"] } }),
      property({ features: { rooms: "2+1", sqm: 120, heating: "Soba" } }),
    );
    const e = explainMatch(r);
    expect(e.eliminated).toBe(true);
    expect(e.matched).toEqual(expect.arrayContaining(["İşlem türü", "Bütçe"]));
    expect(e.missed.map((m) => m.label)).toEqual(expect.arrayContaining(["Oda", "Isınma"]));
    expect(e.missed.find((m) => m.label === "Isınma")).toMatchObject({
      required: true,
      detail: "talep Merkezi, portföy Soba",
    });
    expect(e.summary).toContain("Elendi (olmazsa olmaz): Isınma");
    expect(e.summary).toContain("Isınma (olmazsa olmaz)");
  });

  it("belirsiz alanlar ayrı listelenir, uyuşanlara karışmaz", () => {
    const e = explainMatch(
      scoreDemandProperty(demand({ rooms: null, min_sqm: null, budget_min: null, budget_max: null }), property()),
    );
    expect(e.unknown).toEqual(expect.arrayContaining(["Bütçe", "Oda"]));
    expect(e.matched).not.toContain("Bütçe");
  });
});
