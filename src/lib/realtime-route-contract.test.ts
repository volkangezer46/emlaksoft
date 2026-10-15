import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ALL_NAV_HREFS } from "@/lib/nav-config";
import {
  BROADCAST_TABLES,
  COMPONENT_LIVE_ROUTES,
  DETAIL_ROUTES,
  NOT_LIVE_ROUTES,
  NOTIFICATIONS_TABLE,
  ROUTE_TABLES,
  tablesForPath,
} from "@/lib/realtime-throttle";
import {
  emitNotificationInsert,
  NOTIF_INSERT_EVENT,
  NOTIFICATION_ROW_FIELDS,
  onNotificationInsert,
  realtimeIssueKind,
  toNotificationRow,
  type NotificationInsertRow,
} from "@/lib/realtime";
import { readCached, walkSource } from "@/lib/test-support/src-tree";

/**
 * SK2 REALTIME-1 SÖZLEŞMESİ (B002/B005/B007/B008): canlı veri haritası tek kaynaktır (src/lib/realtime-throttle.ts).
 *  (1) Realtime'a abone olan HER dosya (useRealtimeRefresh / subscribeTopic / subscribeToInserts / postgres_changes)
 *      bilinen bir tüketicidir: layout kancası, bileşeni canlı veriyi yöneten rota (COMPONENT_LIVE_ROUTES) ya da
 *      personel görünümü. Yeni abone dosya eşlemeye eklenmeden bu test kırılır.
 *  (2) Menüdeki HER /app rotası ya canlıdır (ROUTE_TABLES / bileşen / ana pano) ya da gerekçeli NOT_LIVE_ROUTES'tadır.
 *  (3) Bildirim olayı (sözleşme j): kişisel (inbox yükü) ve ortak (RLS'li okuma) yol AYNI NotificationInsertRow'u yayar.
 *  (4) Sunucu betiği (realtime-policies.sql) migration'daki okuma politikalarıyla birebir aynıdır.
 */
const ROOT = process.cwd();
const rel = (abs: string) => relative(ROOT, abs).replace(/\\/g, "/");
const read = (p: string) => readCached(resolve(ROOT, p));
const norm = (p: string) => p.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

const SUBSCRIBE_RE = /useRealtimeRefresh\(|subscribeTopic\(|subscribeToInserts\(|["']postgres_changes["']/;
/** Altyapı (tanım yerleri) ve layout tüketicisi. */
const INFRA = new Set(["src/lib/realtime.ts", "src/hooks/use-realtime-refresh.ts", "src/components/app/realtime-refresh.tsx"]);
/** postgres_changes'i yalnız platform personeli görünümünde kullanan dosyalar (personel ofis konusuna katılamaz). */
const STAFF_PG_CHANGES = new Set(["src/app/app/destek/[id]/ticket-thread.tsx"]);

function subscriberFiles(): string[] {
  return walkSource(resolve(ROOT, "src"))
    .filter((f) => SUBSCRIBE_RE.test(readCached(f)))
    .map(rel)
    .sort();
}

/** Paket kapsamındaki yeni canlı ekranlar (SK2 B005/B007/B008). */
const SK2_LIVE = [
  "/app/onaylar",
  "/app/hedefler",
  "/app/lig",
  "/app/ekip",
  "/app/ofis-kontrol",
  "/app/destek",
  "/app/gelen-kutusu",
  "/app/bildirimler",
  "/app/sozlesmeler",
];

describe("canlı abonelik envanteri", () => {
  const files = subscriberFiles();
  const componentFiles = new Set(Object.values(COMPONENT_LIVE_ROUTES));

  it("tarayıcı gerçek aboneleri bulur", () => {
    for (const f of ["src/components/app/realtime-refresh.tsx", "src/components/listing-control/live-refresh.tsx", "src/app/app/pano-tv/tv-hooks.ts"]) {
      expect(files, f).toContain(f);
    }
  });

  it("abone olan her dosya eşlemede (altyapı, layout, bileşen rotası ya da personel görünümü)", () => {
    const unknown = files.filter((f) => !INFRA.has(f) && !componentFiles.has(f) && !STAFF_PG_CHANGES.has(f));
    expect(unknown, "yeni abone: COMPONENT_LIVE_ROUTES'a ekleyin ya da rotayı ROUTE_TABLES ile canlı yapın").toEqual([]);
  });

  it("bileşen rotalarının dosyası var, ofis konusuna abone olur ve rota sayfası mevcut", () => {
    for (const [route, file] of Object.entries(COMPONENT_LIVE_ROUTES)) {
      expect(existsSync(resolve(ROOT, file)), file).toBe(true);
      expect(read(file), file).toMatch(/subscribeTopic\(tenantTopic\(|useRealtimeRefresh\(/);
      expect(existsSync(resolve(ROOT, `src/app${route}/page.tsx`)), route).toBe(true);
    }
  });

  it("postgres_changes yalnız personel görünümünde (ofis görünümü Broadcast)", () => {
    for (const f of files) {
      if (INFRA.has(f)) continue;
      const text = read(f);
      if (!/subscribeToInserts\(|["']postgres_changes["']/.test(text)) continue;
      expect(STAFF_PG_CHANGES.has(f), f).toBe(true);
      expect(text, f).toMatch(/audience !== "staff"\) return;/);
    }
    // Layout kancası postgres_changes'i yalnız geri düşüşte (yetki reddi) açar.
    expect(read("src/components/app/realtime-refresh.tsx")).not.toMatch(/postgres_changes/);
  });

  it("ofis konusu tüketicileri tabloları Broadcast kapsamından seçer", () => {
    const known = new Set<string>([...BROADCAST_TABLES, NOTIFICATIONS_TABLE]);
    for (const f of files) {
      for (const m of read(f).matchAll(/useRealtimeRefresh\(\{[^}]*\btables:\s*\[([^\]]*)\]/g)) {
        for (const t of m[1].matchAll(/"([a-z_]+)"/g)) expect(known.has(t[1]), `${f}: ${t[1]}`).toBe(true);
      }
      for (const m of read(f).matchAll(/const\s+RT_TABLES\s*=\s*\[([^\]]*)\]/g)) {
        for (const t of m[1].matchAll(/"([a-z_]+)"/g)) expect(known.has(t[1]), `${f}: ${t[1]}`).toBe(true);
      }
    }
  });
});

describe("menü rotaları: canlı ya da gerekçeli 'canlı değil'", () => {
  const navApp = [...new Set(ALL_NAV_HREFS.map(norm).filter((h) => h === "/app" || h.startsWith("/app/")))];
  const isLive = (h: string) =>
    h === "/app" ||
    ROUTE_TABLES.some(([p]) => under(h, p)) ||
    Object.keys(COMPONENT_LIVE_ROUTES).some((p) => !p.includes("[") && under(h, p));
  const isNotLive = (h: string) => Object.keys(NOT_LIVE_ROUTES).some((p) => under(h, p));

  it("en az 30 menü rotası tarandı", () => {
    expect(navApp.length).toBeGreaterThan(30);
  });

  it("her menü rotası ya eşlemede ya NOT_LIVE_ROUTES'ta", () => {
    expect(navApp.filter((h) => !isLive(h) && !isNotLive(h))).toEqual([]);
  });

  it("NOT_LIVE_ROUTES bayat değil, gerekçeli ve canlı rotalarla çakışmaz", () => {
    for (const [p, why] of Object.entries(NOT_LIVE_ROUTES)) {
      expect(navApp.some((h) => under(h, p)), `${p} menüde yok`).toBe(true);
      expect(why.length, p).toBeGreaterThan(8);
      expect(ROUTE_TABLES.some(([r]) => under(r, p) || under(p, r)), `${p} canlı eşlemeyle çakışıyor`).toBe(false);
    }
  });

  it("SK2 ekranları canlı: onaylar, hedefler, lig, ekip, ofis kontrol, destek, gelen kutusu, bildirimler, sözleşmeler", () => {
    for (const r of SK2_LIVE) {
      expect(isLive(r), r).toBe(true);
      const own = ROUTE_TABLES.find(([p]) => p === r)?.[1] ?? [];
      expect(own.length, r).toBeGreaterThan(0);
      for (const t of own) expect(tablesForPath(r), `${r}: ${t}`).toContain(t);
    }
    expect(Object.keys(COMPONENT_LIVE_ROUTES)).toContain("/app/destek/[id]");
  });

  it("müşteri detayı ilişkili görev/randevu/arama kayıtlarını kimlikle süzer", () => {
    const customer = DETAIL_ROUTES.find((d) => d.prefix === "/app/musteriler");
    expect(customer?.self).toBe("customers");
    for (const t of ["tasks", "appointments", "calls"]) expect(customer?.related, t).toContain(t);
  });
});

describe("sözleşme j: bildirim olayı NotificationInsertRow", () => {
  const row: NotificationInsertRow = {
    id: "5a2a0000-0000-4000-8000-0000000000f1",
    tenant_id: "5a2a0000-0000-4000-8000-0000000000a1",
    user_id: null,
    title: "Ofis duyurusu",
    body: null,
    href: "/app/onaylar",
    kind: "info",
    read_at: null,
    created_at: "2026-10-16T09:00:00.000Z",
  };

  it("olay detayı ve dinleyici parametresi NotificationInsertRow tipinde", () => {
    expectTypeOf(emitNotificationInsert).parameter(0).toEqualTypeOf<NotificationInsertRow>();
    expectTypeOf(onNotificationInsert).parameter(0).parameter(0).toEqualTypeOf<NotificationInsertRow>();
    expectTypeOf<(typeof NOTIFICATION_ROW_FIELDS)[number]>().toEqualTypeOf<keyof NotificationInsertRow>();
    expectTypeOf(toNotificationRow).returns.toEqualTypeOf<NotificationInsertRow | null>();
  });

  it("alan listesi tip anahtarlarıyla ve migration'ın inbox yüküyle birebir", () => {
    expect([...NOTIFICATION_ROW_FIELDS].sort()).toEqual(Object.keys(row).sort());
    const sql = read("supabase/migrations/20261016020000_tenant_broadcast_changes.sql");
    const body = /create or replace function public\.rt_emit_notification\(\)[\s\S]*?jsonb_build_object\(([\s\S]*?)\),\s*'notification'/.exec(sql);
    expect(body).not.toBeNull();
    const keys = [...body![1].matchAll(/'([a-z_]+)',\s*new\./g)].map((m) => m[1]).sort();
    expect(keys).toEqual([...NOTIFICATION_ROW_FIELDS].sort());
  });

  it("inbox yükü ve RLS'li okuma aynı satırı üretir; eksik zorunlu alan reddedilir", () => {
    expect(toNotificationRow({ ...row, extra: "x" })).toEqual(row);
    expect(toNotificationRow({ ...row, kind: undefined })).toBeNull();
    expect(toNotificationRow({ id: row.id })).toBeNull();
    const src = read("src/components/app/realtime-refresh.tsx");
    expect(src).toContain('select(NOTIFICATION_ROW_FIELDS.join(", "))');
    expect((src.match(/toNotificationRow\(/g) ?? []).length).toBe(2);
    expect(NOTIF_INSERT_EVENT).toBe("es:notification-insert");
  });

  it("emitNotificationInsert olay detayı aynı nesne", () => {
    const seen: unknown[] = [];
    const target = new EventTarget();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = target;
    try {
      const off = onNotificationInsert((r) => seen.push(r));
      emitNotificationInsert(row);
      off();
      emitNotificationInsert(row);
    } finally {
      g.window = prev;
    }
    expect(seen).toEqual([row]);
  });
});

describe("Broadcast yükü ve okuma politikaları", () => {
  const sql = read("supabase/migrations/20261016020000_tenant_broadcast_changes.sql");

  it("ofis olayı yalnız {t, op, ids, r, by, bulk, id}: kişisel veri alanı yok", () => {
    const fn = /create or replace function public\.rt_emit_tenant_change\(\)([\s\S]*?)\$\$;/.exec(sql)?.[1] ?? "";
    // jsonb_build_object anahtarlari: 'anahtar', <deger ifadesi>
    const keys = new Set([...fn.matchAll(/'([a-z_]+)',\s*(?:tg_table_name|tg_op|true|v_by|pg_catalog\.)/g)].map((m) => m[1]));
    expect([...keys].sort()).toEqual(["bulk", "by", "id", "ids", "op", "r", "t"]);
    expect(fn).toMatch(/r\.n > 50/);
    expect(sql).toMatch(/for each statement execute function public\.rt_emit_tenant_change/);
  });

  it("en kötü tek satırlık olay (en uzun tablo adı + r + by + kısa id) ≤ 200 B", () => {
    const uuid = "5a2a0000-0000-4000-8000-0000000000a1";
    const longest = [...BROADCAST_TABLES].sort((a, b) => b.length - a.length)[0];
    const payload = { t: longest, op: "INSERT", ids: [uuid], r: [uuid], by: uuid, id: "ffffffff" };
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(200);
  });

  it("sunucu betiğindeki politikalar migration'dakiyle aynı", () => {
    const script = read("scripts/sunucu/realtime-policies.sql");
    const policies = (text: string) =>
      [...text.matchAll(/create policy (rt_[a-z_]+) on realtime\.messages([\s\S]*?)\)\s*(?:\$p\$|;)/g)].map((m) => `${m[1]}:${m[2].replace(/\s+/g, " ").trim()}`);
    const fromMigration = policies(sql);
    expect(fromMigration).toHaveLength(2);
    expect(policies(script)).toEqual(fromMigration);
  });

  it("abonelik hatası telemetri türü: yetki > sınır > ham durum", () => {
    expect(realtimeIssueKind("CHANNEL_ERROR", "Unauthorized: You do not have permissions", true)).toBe("UNAUTHORIZED");
    expect(realtimeIssueKind("CHANNEL_ERROR", "Too many connected users", false)).toBe("LIMIT");
    expect(realtimeIssueKind("SYSTEM_ERROR", "ConnectionRateLimitReached", false)).toBe("LIMIT");
    expect(realtimeIssueKind("TIMED_OUT", undefined, false)).toBe("TIMED_OUT");
  });
});
