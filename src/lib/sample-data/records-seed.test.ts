import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMetadataOnlyFilePath } from "@/lib/doc-request/doc-request";
import { diffInspections, normalizeMeters, normalizeRooms } from "@/lib/rentals/inspection";
import {
  APPLICANT_DEFS,
  DOC_REQUEST_DEFS,
  buildBudgetRows,
  buildInspectionRooms,
  buildMeters,
  monthKeyBack,
  seedDocumentRequests,
  seedFinanceBudgets,
  seedRentalApplications,
  seedRentalInspections,
  type RecordsSeedContext,
} from "./records-seed";

const NOW = Date.parse("2026-10-17T09:00:00Z");
vi.mock("@/lib/clock", async (orig) => ({ ...(await orig<typeof import("@/lib/clock")>()), now: () => NOW }));

/** Okumada tabloya göre sabit satır döndüren, yazmayı kaydedip kimlikle geri veren sahte istemci (zincirleme builder). */
function fakeDb(rows: Record<string, Record<string, unknown>[]>) {
  const inserts: Record<string, Record<string, unknown>[]> = {};
  let seq = 0;
  const db = {
    from(table: string) {
      let pending: Record<string, unknown>[] | null = null;
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get(_t, prop) {
          if (prop === "then") {
            const data = pending ?? rows[table] ?? [];
            return (resolve: (v: unknown) => void) => resolve({ data, error: null });
          }
          if (prop === "insert" || prop === "upsert") {
            return (input: Record<string, unknown> | Record<string, unknown>[]) => {
              const list = (Array.isArray(input) ? input : [input]).map((r) => ({ id: `${table}-${++seq}`, ...r }));
              (inserts[table] ??= []).push(...list);
              pending = list;
              return self;
            };
          }
          return () => self;
        },
      });
      return self;
    },
  } as unknown as SupabaseClient;
  return { db, inserts };
}

const ctx = (db: SupabaseClient): RecordsSeedContext => ({ db, tenantId: "t-1", ownerId: "u-owner", advisorId: "u-adv", sample: true });

const PROPS = [
  { id: "p-1", property_code: "EMS-1001", title: "Kadıköy 3+1", transaction_type: "Satılık", property_type: "Daire", status: "live", list_price: 12_000_000, owner_customer_id: "c-1" },
  { id: "p-2", property_code: "EMS-1006", title: "Nişantaşı dükkan", transaction_type: "Kiralık", property_type: "Dükkan", status: "live", list_price: 95_000, owner_customer_id: "c-2" },
  { id: "p-3", property_code: "EMS-0801", title: "Beşiktaş 1+1", transaction_type: "Kiralık", property_type: "Daire", status: "rented", list_price: 28_000, owner_customer_id: "c-3" },
];
const RENTALS = [
  { id: "r-1", property_id: "p-3", renter_customer_id: "c-9", monthly_rent: 28_000, deposit: 56_000, start_date: "2026-06-01", end_date: "2027-06-01", status: "active", created_at: "2026-05-28T10:00:00Z" },
];
const CUSTOMERS = [{ id: "c-9", full_name: "Deniz Karaca", phone: "05320000110" }];

describe("finans bütçesi planı", () => {
  const expenses = [0, 1, 2, 3, 4, 5].flatMap((b) => {
    const m = monthKeyBack(NOW, b);
    return [
      { category: "ofis", amount: 48_000, expense_date: `${m.slice(0, 8)}03` },
      { category: "reklam", amount: 10_000, expense_date: `${m.slice(0, 8)}06` },
      { category: "ulasim", amount: 2_550, expense_date: `${m.slice(0, 8)}18` },
    ];
  });
  const rows = buildBudgetRows(NOW, expenses);

  it("son 6 ay × (gider kategorisi + gelir hedefi); tutarlar tam TL ve pozitif", () => {
    const months = new Set(rows.map((r) => r.period_month));
    expect([...months].sort()).toEqual([5, 4, 3, 2, 1, 0].map((b) => monthKeyBack(NOW, b)));
    for (const r of rows) {
      expect(r.period_month.endsWith("-01")).toBe(true);
      expect(Number.isInteger(r.amount)).toBe(true);
      expect(r.amount).toBeGreaterThan(0);
    }
    expect(new Set(rows.filter((r) => r.direction === "out").map((r) => r.category))).toEqual(new Set(["ofis", "reklam", "ulasim"]));
    expect(rows.filter((r) => r.direction === "in").map((r) => r.category)).toContain("komisyon");
  });

  it("gerçekleşenle tutarlı: ofis rahat, reklam bu ay aşılıyor, gideri olmayan kategoriye bütçe yok", () => {
    const cur = monthKeyBack(NOW, 0);
    const at = (c: string) => rows.find((r) => r.period_month === cur && r.direction === "out" && r.category === c)!.amount;
    expect(at("ofis")).toBeGreaterThan(48_000);
    expect(at("reklam")).toBeLessThan(10_000);
    expect(rows.some((r) => r.category === "egitim")).toBe(false);
  });
});

describe("teslim / tahliye tutanağı planı", () => {
  it("odalar normalizasyondan değişmeden geçer; tahliye girişe göre kötüleşen kalem içerir (kesinti önerisi doğar)", () => {
    for (const type of ["Daire", "Ofis", "Dükkan"]) {
      const moveIn = buildInspectionRooms(type, "move_in");
      const moveOut = buildInspectionRooms(type, "move_out");
      expect(normalizeRooms(moveIn)).toEqual(moveIn);
      expect(moveIn.length).toBeGreaterThan(2);
      expect(diffInspections(moveIn, moveOut).length).toBeGreaterThan(0);
      expect(diffInspections(moveIn, moveIn)).toEqual([]);
    }
  });

  it("sayaç okumaları biçime uyar ve tahliyede ilerler", () => {
    const a = buildMeters(1, "move_in", 0);
    const b = buildMeters(1, "move_out", 5);
    expect(normalizeMeters(a)).toEqual(a);
    expect(Number(b.electricity.reading.replace(",", "."))).toBeGreaterThan(Number(a.electricity.reading.replace(",", ".")));
  });
});

describe("kayıt modülü tohumları (sahte istemci)", () => {
  it("evrak talepleri gerçek örnek müşteri/portföye bağlı; dosyalar YALNIZ KAYIT BİLGİSİ (depo yolu değil) ve doğrulanmış", async () => {
    const { db, inserts } = fakeDb({ properties: PROPS, rentals: RENTALS, document_requests: [] });
    const n = await seedDocumentRequests(ctx(db));
    const reqs = inserts.document_requests!;
    const files = inserts.document_request_files!;
    expect(reqs.length).toBe(DOC_REQUEST_DEFS.length);
    expect(n).toBe(reqs.length + files.length);
    for (const r of reqs) {
      expect(r.is_sample).toBe(true);
      expect(["c-1", "c-2", "c-3", "c-9"]).toContain(r.customer_id);
      expect(String(r.token_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(String(r.created_at))).toBeLessThanOrEqual(NOW);
      expect(Date.parse(String(r.created_at))).toBeGreaterThan(NOW - 183 * 86_400_000);
    }
    expect(new Set(reqs.map((r) => r.status))).toEqual(new Set(["completed", "active", "revoked"]));
    for (const f of files) {
      expect(isMetadataOnlyFilePath(String(f.storage_path))).toBe(true);
      expect(f.status).toBe("verified");
    }
    for (const r of reqs) expect(r.file_count).toBe(files.filter((f) => f.request_id === r.id).length);
  });

  it("başvurular: açık kiralık ilana aktif bağlantı + adaylar; kiraya verilmiş portföyde onaylanan aday kiracının kendisi", async () => {
    const { db, inserts } = fakeDb({ properties: PROPS, rentals: RENTALS, customers: CUSTOMERS, rental_application_links: [] });
    await seedRentalApplications(ctx(db));
    const links = inserts.rental_application_links!;
    const apps = inserts.rental_applications!;
    expect(links.map((l) => [l.property_id, l.status])).toEqual([["p-2", "active"], ["p-3", "closed"]]);
    for (const l of links) expect(String(l.token)).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    expect(apps.filter((a) => a.link_id === links[0]!.id).length).toBe(APPLICANT_DEFS[0]!.length);
    const approved = apps.find((a) => a.status === "approved")!;
    expect(approved).toMatchObject({ customer_id: "c-9", rental_id: "r-1", full_name: "Deniz Karaca", owner_decision: "approved" });
    for (const a of apps) {
      expect(String(a.phone)).toMatch(/^0[0-9]{10}$/);
      expect(Number(a.monthly_income) % 1_000).toBe(0);
      expect(a.is_sample).toBe(true);
    }
    const phones = apps.map((a) => `${a.link_id}|${a.phone}`);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it("tutanaklar: her kiraya kesinleşmiş teslim, en eski kirada taslak tahliye; kira başına tür başına tek", async () => {
    const { db, inserts } = fakeDb({ properties: PROPS, rentals: RENTALS, rental_inspections: [] });
    await seedRentalInspections(ctx(db));
    const rows = inserts.rental_inspections!;
    expect(rows.map((r) => [r.rental_id, r.kind, r.status])).toEqual([["r-1", "move_in", "final"], ["r-1", "move_out", "draft"]]);
    expect(rows[0]!.inspected_on).toBe("2026-06-01");
    expect(rows[0]!.finalized_at).not.toBeNull();
    expect(rows[1]!.finalized_at).toBeNull();
  });

  it("bütçe ve diğer gruplar idempotent: tabloda örnek satır varsa yazmaz", async () => {
    const { db, inserts } = fakeDb({ finance_budgets: [{ id: "b" }], document_requests: [{ id: "d" }], rental_application_links: [{ id: "l" }], rental_inspections: [{ id: "i" }] });
    expect(await seedFinanceBudgets(ctx(db))).toBe(0);
    expect(await seedDocumentRequests(ctx(db))).toBe(0);
    expect(await seedRentalApplications(ctx(db))).toBe(0);
    expect(await seedRentalInspections(ctx(db))).toBe(0);
    expect(inserts).toEqual({});
  });
});
