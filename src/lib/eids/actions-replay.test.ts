import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * EİDS aksiyon motoru — YENİDEN OYNATMA güvenliği (cron son 3 günün olaylarını her turda yeniden işler).
 * Bellek içi küçük bir PostgREST taklidi üzerinde gerçek `onAuthorityEvent` çalışır.
 * Kabul: revoke1 → undo → revoke2 sırası yeniden oynatılınca açık kaldırma görevi İPTAL EDİLMEZ, vitrin yeniden yayına
 * alınmaz; uzatma yalnız otomasyon/içgörü kaynaklı ve olaydan önce açılmış yenileme görevlerini kapatır; kalem yazılamazsa
 * görev geri alınır.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifyTenant: async () => undefined }));
vi.mock("@/lib/settings/tenant-read", () => ({ readTenantSettings: async () => ({}), numberSetting: (_v: unknown, _k: string, f: number) => f }));
vi.mock("@/lib/listing-control/server/queue", () => ({ enqueueTakedownChecks: async () => ({ hasClient: false, enqueued: 0, schemaMissing: false }) }));
vi.mock("@/lib/modules/state", () => ({ getDisabledModulesByTenant: async () => new Map(), isDisabledFor: () => false }));
vi.mock("@/lib/supabase/fetch-all", () => ({ fetchAllRowsKeepError: async () => ({ data: [], error: null }) }));

const { onAuthorityEvent } = await import("@/lib/eids/actions");

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let clock: number;
let failItemsInsert = false;
let seq = 0;

const iso = (ms: number) => new Date(ms).toISOString();

/** Yalnız motorun kullandığı PostgREST zinciri: filtre + sıralama + sınır + insert/update/delete. */
function fakeDb(): SupabaseClient {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row[] = [];
    let limit = Infinity;
    let wantRows = false;
    const rows = () => (tables[table] ??= []);
    const like = (v: unknown, pat: string, ci: boolean) => {
      const re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, ci ? "i" : "");
      return re.test(String(v ?? ""));
    };
    const run = (): { data: unknown; error: unknown } => {
      if (op === "insert") {
        if (table === "eids_takedown_items" && failItemsInsert) return { data: null, error: { code: "23502", message: "fail" } };
        const out: Row[] = [];
        for (const r of inserted) {
          if (table === "tasks" && r.dedupe_key && rows().some((x) => x.tenant_id === r.tenant_id && x.dedupe_key === r.dedupe_key)) {
            return { data: null, error: { code: "23505", message: "dup" } };
          }
          const row = { id: `${table}-${++seq}`, created_at: iso(clock), ...r };
          rows().push(row);
          out.push(row);
        }
        return { data: out, error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === "update") for (const r of hit) Object.assign(r, patch);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      return { data: op === "select" || wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => ((wantRows = true), q),
      insert: (v: Row | Row[]) => ((op = "insert"), (inserted = Array.isArray(v) ? v : [v]), q),
      update: (v: Row) => ((op = "update"), (patch = v), q),
      delete: () => ((op = "delete"), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      not: (k: string, o: string, v: unknown) => {
        if (o === "in") filters.push((r) => !String(v).slice(1, -1).split(",").includes(String(r[k])));
        else filters.push((r) => (r[k] ?? null) !== v);
        return q;
      },
      lt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) < v), q),
      gt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) > v), q),
      gte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) >= v), q),
      lte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) <= v), q),
      like: (k: string, v: string) => (filters.push((r) => like(r[k], v, false)), q),
      ilike: (k: string, v: string) => (filters.push((r) => like(r[k], v, true)), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const T = "t1";
const P = "p1";
const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);
const HOUR = 3_600_000;

const property = () => tables.properties.find((r) => r.id === P)!;
const takedowns = () => tables.tasks.filter((t) => t.kind === "eids_takedown");
const ev = (id: string, kind: string, at: number, over: Row = {}) => ({ id, tenant_id: T, property_id: P, kind, created_at: iso(at), ...over });

beforeEach(() => {
  seq = 0;
  failItemsInsert = false;
  tables = {
    properties: [
      { id: P, tenant_id: T, title: "Daire", property_code: "P-1", assigned_to: "u1", branch_id: null, status: "live", authorization_end: "2027-01-01", authority_eids_status: "approved", deleted_at: null, is_sample: false },
    ],
    tasks: [],
    eids_takedown_items: [],
    share_links: [],
    portal_listings: [],
    tenant_portal_accounts: [],
    profiles: [{ id: "own1", tenant_id: T, role: "owner", is_active: true, branch_id: null }],
  };
});

describe("EİDS aksiyon motoru — yeniden oynatma", () => {
  it("revoke1 → undo → revoke2 yeniden oynatılınca açık kaldırma görevi iptal edilmez, vitrin kapalı kalır", async () => {
    const db = fakeDb();
    const revoke1 = ev("r1", "revoke", T0, { prev_status: "approved", new_status: "revoked" });
    const undo = ev("u1", "undo", T0 + HOUR, { prev_status: "revoked", new_status: "approved", undo_of: "r1" });
    const revoke2 = ev("r2", "revoke", T0 + 2 * HOUR, { prev_status: "approved", new_status: "revoked" });

    // Canlı akış.
    clock = T0;
    property().authority_eids_status = "revoked";
    expect((await onAuthorityEvent(db, revoke1, clock)).status).toBe("created");
    expect(property().status).toBe("draft");

    clock = T0 + HOUR;
    property().authority_eids_status = "approved";
    await onAuthorityEvent(db, undo, clock);
    expect(takedowns().map((t) => t.status)).toEqual(["cancelled"]);
    expect(property().status).toBe("live");

    clock = T0 + 2 * HOUR;
    property().authority_eids_status = "revoked";
    expect((await onAuthorityEvent(db, revoke2, clock)).status).toBe("created");
    expect(property().status).toBe("draft");

    // Cron turu: aynı üç olay artan sırayla yeniden oynatılır.
    clock = T0 + 4 * HOUR;
    for (const e of [revoke1, undo, revoke2]) await onAuthorityEvent(db, e, clock);
    expect(takedowns().map((t) => t.status)).toEqual(["cancelled", "open"]);
    expect(property().status).toBe("draft");
  });

  it("geri alma yalnız olaydan ÖNCE açılmış görevi iptal eder (yetki geçerli olsa da)", async () => {
    const db = fakeDb();
    clock = T0 + 3 * HOUR;
    property().authority_eids_status = "revoked";
    await onAuthorityEvent(db, ev("r9", "revoke", clock, { new_status: "revoked" }), clock);
    property().authority_eids_status = "approved";
    // Görevden önce yazılmış eski geri alma olayı (cron yeniden oynatıyor) bu görevi kapatamaz.
    await onAuthorityEvent(db, ev("u0", "undo", T0, { prev_status: "revoked", new_status: "approved", undo_of: "r0" }), clock);
    expect(takedowns().map((t) => t.status)).toEqual(["open"]);
  });

  it("Eşleştir kuyruğundan bağlanan iptal (link + revoked) kaldırma görevi açar", async () => {
    const db = fakeDb();
    clock = T0;
    property().authority_eids_status = "revoked";
    const r = await onAuthorityEvent(db, ev("l1", "link", T0, { prev_status: "approved", new_status: "revoked" }), clock);
    expect(r.status).toBe("created");
    expect(takedowns()[0]).toMatchObject({ status: "open", priority: "urgent", dedupe_key: `eids:takedown:${P}:revoke:l1` });
  });

  it("uzatma yalnız otomasyon/içgörü kaynaklı ve olaydan önce açılmış 'yetki' görevlerini kapatır", async () => {
    const db = fakeDb();
    const base = { tenant_id: T, property_id: P, status: "open", kind: "followup" };
    tables.tasks.push(
      { ...base, id: "a", title: "Yetki yenile", notes: "Otomasyon: Yenileme [oto:1a2b3c4d:5e6f7a8b]", created_at: iso(T0 - HOUR) },
      { ...base, id: "b", title: "Yetki bitiyor", notes: "Neden...\n[ins:abcdef12]", created_at: iso(T0 - HOUR) },
      { ...base, id: "c", title: "Yetki belgesi imzalat", notes: "elle", created_at: iso(T0 - HOUR) },
      { ...base, id: "d", title: "Yetki yenile", notes: "[oto:1a2b3c4d:5e6f7a8b]", created_at: iso(T0 + HOUR) },
    );
    clock = T0 + 2 * HOUR;
    await onAuthorityEvent(db, ev("x1", "extend", T0), clock);
    const st = Object.fromEntries(tables.tasks.map((t) => [t.id, t.status]));
    expect(st).toEqual({ a: "done", b: "done", c: "open", d: "open" });
  });

  it("kalemler yazılamazsa görev geri alınır ve vitrin eski haline döner (sonraki tur yeniden dener)", async () => {
    const db = fakeDb();
    clock = T0;
    failItemsInsert = true;
    const r = await onAuthorityEvent(db, ev("r5", "revoke", T0, { new_status: "revoked" }), clock);
    expect(r.status).toBe("error");
    expect(takedowns()).toHaveLength(0);
    expect(property().status).toBe("live");
    failItemsInsert = false;
    expect((await onAuthorityEvent(db, ev("r5", "revoke", T0, { new_status: "revoked" }), clock)).status).toBe("created");
  });
});
