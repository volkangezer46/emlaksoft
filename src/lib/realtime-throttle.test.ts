import { describe, expect, it } from "vitest";
import {
  REALTIME_ALL_TABLES,
  REALTIME_EXTENDED_TABLES,
  REALTIME_MORE_TABLES,
  ROUTE_TABLES,
  tablesForPath,
} from "./realtime-throttle";

// Realtime aboneliği rotaya iner: tablo kümesinin TEK kaynağı ROUTE_TABLES (bkz. use-realtime-refresh.ts).
describe("tablesForPath: rota → tablo kümesi", () => {
  it("rota öneki ve alt yolları eşlenir; sorgu/çapa/son eğik çizgi yok sayılır", () => {
    expect(tablesForPath("/app/musteriler")).toEqual(["customers"]);
    expect(tablesForPath("/app/musteriler/abc?x=1#y")).toEqual(["customers"]);
    expect(tablesForPath("/app/anlasmalar/")).toEqual(["deals", "commissions"]);
    expect(tablesForPath("/app/kiralama")).toEqual(["deals", "properties", "rent_charges", "rent_payments"]);
  });

  it("daha özel önek önce gelir (anahtarlar ⊂ portföyler)", () => {
    expect(tablesForPath("/app/portfoyler/anahtarlar")).toEqual(["property_keys", "properties"]);
    expect(tablesForPath("/app/portfoyler/123")).toEqual(["portal_listings", "properties"]);
  });

  it("ilgisiz / bilinmeyen rota boş küme (kanal açılmaz)", () => {
    for (const p of ["/app/ayarlar", "/app/musteriler-x", "/admin", "/", "", null, undefined]) {
      expect(tablesForPath(p), String(p)).toEqual([]);
    }
  });

  it("ana pano: ROUTE_TABLES birleşimi, tekrarsız; yayındaki tüm çekirdek/ek tabloları kapsar", () => {
    const home = tablesForPath("/app");
    expect(new Set(home).size).toBe(home.length);
    expect([...home].sort()).toEqual([...new Set(ROUTE_TABLES.flatMap(([, t]) => t))].sort());
    for (const t of [...REALTIME_ALL_TABLES, ...REALTIME_EXTENDED_TABLES, ...REALTIME_MORE_TABLES]) expect(home).toContain(t);
    expect(home).not.toContain("notifications");
  });

  it("her rota tablosu bilinen yayın listelerinden birinde (yayında olmayan tablo kanalı sessiz bırakır)", () => {
    const known = new Set<string>([...REALTIME_ALL_TABLES, ...REALTIME_EXTENDED_TABLES, ...REALTIME_MORE_TABLES]);
    for (const [prefix, tables] of ROUTE_TABLES) {
      expect(prefix.startsWith("/app/"), prefix).toBe(true);
      for (const t of tables) expect(known.has(t), `${prefix}: ${t}`).toBe(true);
    }
  });
});
