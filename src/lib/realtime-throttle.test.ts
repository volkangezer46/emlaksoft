import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROADCAST_TABLES,
  computeRefreshDelay,
  DETAIL_ROUTES,
  detailForPath,
  eventMatchesPath,
  GLOBAL_TABLES,
  HOME_TABLES,
  LEGACY_PUBLICATION_TABLES,
  needsOpenWindowRefresh,
  NOTIFICATIONS_TABLE,
  parseTenantChange,
  realtimeBackoffMs,
  REALTIME_HOME_MIN_INTERVAL_MS,
  REALTIME_MIN_INTERVAL_MS,
  ROUTE_TABLES,
  routesForTable,
  tablesForPath,
} from "./realtime-throttle";

const G = GLOBAL_TABLES;
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

/** Migration'daki tetikleyici tablo listesi (values satırları). */
function migrationTables(): string[] {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261016020000_tenant_broadcast_changes.sql"), "utf8");
  const block = /select \* from \(values([\s\S]*?)\) as v\(tbl, ref, mode, ignore_cols\)/.exec(sql);
  if (!block) throw new Error("tetikleyici listesi bulunamadı");
  return [...block[1].matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]);
}

describe("tablesForPath: rota → tablo kümesi (ofis konusu süzgeci)", () => {
  it("rota öneki ve alt yolları eşlenir; sorgu/çapa/son eğik çizgi yok sayılır; ortak tablolar her rotada", () => {
    expect(tablesForPath("/app/musteriler")).toEqual(["customers", ...G]);
    expect(tablesForPath("/app/musteriler/yeni?x=1#y")).toEqual(["customers", ...G]);
    expect(tablesForPath("/app/anlasmalar/")).toEqual(["deals", "commissions", ...G]);
    expect(tablesForPath("/app/kiralama")).toEqual(["deals", "properties", "rent_charges", "rent_payments", ...G]);
  });

  it("daha özel önek önce gelir (anahtarlar ⊂ portföyler)", () => {
    expect(tablesForPath("/app/portfoyler/anahtarlar")).toEqual(["property_keys", "properties", ...G]);
    expect(tablesForPath("/app/portfoyler/123")).toEqual(["portal_listings", "properties", ...G]);
  });

  it("SK2 yeni rotalar: onaylar, hedefler, lig, ekip, ofis kontrol, destek, gelen kutusu, bildirimler, sözleşmeler", () => {
    expect(tablesForPath("/app/onaylar")).toEqual(["approval_requests"]);
    expect(tablesForPath("/app/destek")).toContain("support_tickets");
    expect(tablesForPath("/app/gelen-kutusu")).toEqual(expect.arrayContaining(["calls", "communications"]));
    expect(tablesForPath("/app/bildirimler")).toContain(NOTIFICATIONS_TABLE);
    expect(tablesForPath("/app/sozlesmeler")).toContain("contracts");
    expect(tablesForPath("/app/ekip/takimlar")).toEqual(expect.arrayContaining(["profiles", "branches", "teams"]));
    for (const p of ["/app/hedefler", "/app/lig", "/app/ofis-kontrol"]) expect(tablesForPath(p).length, p).toBeGreaterThan(G.length);
  });

  it("detay rotası kendi + ilişkili tabloları; destek konuşması bileşene bırakılır (yalnız ortak tablolar)", () => {
    expect(tablesForPath(`/app/musteriler/${U1}`)).toEqual(expect.arrayContaining(["customers", "tasks", "appointments", "calls"]));
    expect(tablesForPath(`/app/anlasmalar/${U1}`)).toEqual(expect.arrayContaining(["deals", "commissions", "deal_notes"]));
    expect(tablesForPath(`/app/destek/${U1}`)).toEqual([...G]);
  });

  it("/app dışı rota boş küme; /app altındaki bilinmeyen rota yalnız ortak tablolar", () => {
    for (const p of ["/admin", "/", "", null, undefined, "/appx"]) expect(tablesForPath(p), String(p)).toEqual([]);
    expect(tablesForPath("/app/ayarlar")).toEqual([...G]);
    expect(tablesForPath("/app/musteriler-x")).toEqual([...G]);
  });

  it("ana pano yalnız gösterdiği özetler (B002: 17 tablo değil), onay talebi dahil", () => {
    const home = tablesForPath("/app");
    expect(new Set(home).size).toBe(home.length);
    expect(home.length).toBeLessThanOrEqual(12);
    expect(home).toContain("approval_requests");
    for (const t of ["cash_entries", "rent_payments", "fsbo_leads", "listing_control_events", "notifications"]) expect(home).not.toContain(t);
  });
});

describe("Broadcast kapsamı", () => {
  it("BROADCAST_TABLES = migration tetikleyici listesi (iki yönlü)", () => {
    expect([...BROADCAST_TABLES].sort()).toEqual(migrationTables().sort());
  });

  it("her rota/detay/pano tablosu Broadcast kapsamında (notifications ayrı olay)", () => {
    const known = new Set<string>([...BROADCAST_TABLES, NOTIFICATIONS_TABLE]);
    for (const [prefix, tables] of ROUTE_TABLES) {
      expect(prefix.startsWith("/app/"), prefix).toBe(true);
      for (const t of tables) expect(known.has(t), `${prefix}: ${t}`).toBe(true);
    }
    for (const d of DETAIL_ROUTES) for (const t of [d.self, ...d.related]) expect(known.has(t), `${d.prefix}: ${t}`).toBe(true);
    for (const t of [...HOME_TABLES, ...G]) expect(known.has(t), t).toBe(true);
  });

  it("eski yol (geri düşüş) yalnız 2026-10-15 yayınındaki tablolar", () => {
    const keep = readFileSync(resolve(process.cwd(), "supabase/migrations/20261015017000_realtime_publication_trim.sql"), "utf8");
    for (const t of LEGACY_PUBLICATION_TABLES) expect(keep, t).toContain(`'${t}'`);
  });

  it("detay ilişkili tabloların üst kimlik kolonu tetikleyici argümanıyla aynı (customer_id / deal_id)", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261016020000_tenant_broadcast_changes.sql"), "utf8");
    const refCol: Record<string, string> = { "/app/musteriler": "customer_id", "/app/anlasmalar": "deal_id" };
    for (const d of DETAIL_ROUTES) {
      for (const t of d.related) expect(sql, `${t}`).toContain(`('${t}', '${refCol[d.prefix]}', `);
    }
  });
});

describe("olay süzgeci", () => {
  const detail = detailForPath(`/app/musteriler/${U1}`);

  it("parseTenantChange yalnız beklenen alanları alır; geçersiz yük null", () => {
    expect(parseTenantChange({ t: "tasks", op: "INSERT", ids: [U1], r: [U2], by: U1, extra: "x" })).toEqual({
      t: "tasks",
      op: "INSERT",
      ids: [U1],
      r: [U2],
      by: U1,
      bulk: false,
    });
    expect(parseTenantChange({ t: "tasks", op: "UPDATE", bulk: true })).toMatchObject({ bulk: true });
    for (const bad of [null, [], "x", { op: "INSERT" }, { t: "", op: "INSERT" }]) expect(parseTenantChange(bad)).toBeNull();
  });

  it("tablo kümesinde olmayan olay eşleşmez", () => {
    expect(eventMatchesPath({ t: "deals", op: "INSERT" }, tablesForPath("/app/gorevler"), null)).toBe(false);
    expect(eventMatchesPath({ t: "tasks", op: "INSERT" }, tablesForPath("/app/gorevler"), null)).toBe(true);
  });

  it("müşteri detayı: yalnız bu müşterinin görevi/randevusu/araması; toplu olay her zaman", () => {
    const tables = tablesForPath(`/app/musteriler/${U1}`);
    expect(detail?.id).toBe(U1);
    expect(eventMatchesPath({ t: "tasks", op: "INSERT", ids: ["x"], r: [U1] }, tables, detail)).toBe(true);
    expect(eventMatchesPath({ t: "tasks", op: "INSERT", ids: ["x"], r: [U2] }, tables, detail)).toBe(false);
    expect(eventMatchesPath({ t: "calls", op: "INSERT", ids: ["x"] }, tables, detail)).toBe(true); // r yok: güvenli taraf
    expect(eventMatchesPath({ t: "customers", op: "UPDATE", ids: [U2] }, tables, detail)).toBe(false);
    expect(eventMatchesPath({ t: "customers", op: "UPDATE", ids: [U1] }, tables, detail)).toBe(true);
    expect(eventMatchesPath({ t: "tasks", op: "UPDATE", bulk: true }, tables, detail)).toBe(true);
    expect(eventMatchesPath({ t: "approval_requests", op: "INSERT", ids: ["x"] }, tables, detail)).toBe(true);
  });

  it("detay kimliği yalnız uuid kesimi (yeni / alt sekme değil)", () => {
    expect(detailForPath("/app/musteriler/yeni")).toBeNull();
    expect(detailForPath(`/app/musteriler/${U1.toUpperCase()}/notlar`)?.id).toBe(U1);
  });

  it("rota → geçersizlenecek önekler (kapalı rota önbelleği)", () => {
    expect(routesForTable("tasks")).toEqual(expect.arrayContaining(["/app", "/app/gorevler", "/app/musteriler"]));
    expect(routesForTable("approval_requests")).toEqual(expect.arrayContaining(["/app", "/app/onaylar", "/app/ofis-kontrol"]));
    expect(routesForTable("contracts")).toEqual(["/app/sozlesmeler"]);
  });
});

describe("zamanlama", () => {
  it("ilk olay yalnız debounce; yakın zamanda yenilendiyse alt sınır dolana kadar", () => {
    expect(computeRefreshDelay(1_000, null, 150)).toBe(150);
    expect(computeRefreshDelay(100_500, 100_000, 150)).toBe(1_500);
    expect(computeRefreshDelay(103_000, 100_000, 150)).toBe(150);
    expect(REALTIME_MIN_INTERVAL_MS).toBe(2_000);
    expect(computeRefreshDelay(101_000, 100_000, 150, REALTIME_HOME_MIN_INTERVAL_MS)).toBe(4_000);
  });

  it("açılış penceresi: sayfa verisi 1 sn'den eskiyse tek tazeleme", () => {
    expect(needsOpenWindowRefresh(10_000, 9_500)).toBe(false);
    expect(needsOpenWindowRefresh(10_000, 8_900)).toBe(true);
  });

  it("geri çekilme 1, 2, 4 ... en çok 30 sn (+≤250 ms titreşim)", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((a) => realtimeBackoffMs(a))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(realtimeBackoffMs(0, 999)).toBe(1_250);
  });
});
