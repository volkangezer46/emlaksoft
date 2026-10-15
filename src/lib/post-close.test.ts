import { beforeEach, describe, expect, it, vi } from "vitest";

const logActivity = vi.fn(async (_input: unknown) => ({ ok: true }));
const notifyTenant = vi.fn(async (_input: unknown) => undefined);
vi.mock("@/lib/activity", () => ({ logActivity: (i: unknown) => logActivity(i) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: (i: unknown) => notifyTenant(i) }));

import { notifyPostCloseAdvisors, runPostCloseCleanup } from "./post-close";

type Call = { table: string; op: "select" | "update"; patch?: unknown; filters: [string, string, unknown][] };

/** Zincir sahte istemci: her sorgu kaydedilir, yanıt `respond` ile seçilir. */
function fakeDb(respond: (c: Call) => { data: unknown; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const add = (kind: string) => (col: string, v: unknown) => {
        call.filters.push([kind, col, v]);
        return chain;
      };
      chain.select = () => chain;
      chain.update = (patch: unknown) => {
        call.op = "update";
        call.patch = patch;
        return chain;
      };
      for (const k of ["eq", "in", "is", "gte"]) chain[k] = add(k);
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve({ error: null, ...respond(call) });
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ error: null, ...respond(call) }).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const NOW = new Date("2026-10-15T09:00:00Z");

beforeEach(() => {
  logActivity.mockClear();
  notifyTenant.mockClear();
});

describe("runPostCloseCleanup", () => {
  it("talepleri kapatır, boş yıldönümünü yazar, kalan randevu/teklifleri (alıcınınkiler hariç) bulur, audit düşer", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "properties") return { data: { property_type: "apartment" } };
      if (c.table === "customer_demands" && c.op === "select") {
        return {
          data: [
            { id: "d1", status: "active", transaction_type: "sale", property_type: "apartment" },
            { id: "d2", status: "active", transaction_type: "rent", property_type: null },
          ],
        };
      }
      if (c.table === "customer_demands") return { data: [{ id: "d1" }] };
      if (c.table === "customers") return { data: { id: "c1" } };
      if (c.table === "appointments") {
        return { data: [{ id: "a1", customer_id: "c1" }, { id: "a2", customer_id: "c9" }] };
      }
      if (c.table === "offers") return { data: [{ id: "o1", customer_id: "c9" }] };
      return { data: null };
    });

    const s = await runPostCloseCleanup({
      db, tenantId: "t1", actorId: "u1", dealId: "deal1", dealType: "sale", customerId: "c1", propertyId: "p1", now: NOW,
    });

    expect(s.closedDemands).toEqual([{ id: "d1", previousStatus: "active" }]);
    expect(s.anniversary).toEqual({ customerId: "c1", date: "2026-10-15", note: "Satın alma" });
    expect(s.appointmentIds).toEqual(["a2"]);
    expect(s.offerIds).toEqual(["o1"]);

    const close = calls.find((c) => c.table === "customer_demands" && c.op === "update")!;
    expect(close.patch).toEqual({ status: "closed" });
    expect(close.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(close.filters).toContainEqual(["in", "id", ["d1"]]);
    const ann = calls.find((c) => c.table === "customers")!;
    expect(ann.filters).toContainEqual(["is", "anniversary_date", null]);
    expect(ann.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    const appt = calls.find((c) => c.table === "appointments")!;
    expect(appt.filters).toContainEqual(["gte", "scheduled_at", NOW.toISOString()]);
    expect(appt.filters).toContainEqual(["in", "status", ["pending", "confirmed", "signature"]]);
    const offer = calls.find((c) => c.table === "offers")!;
    expect(offer.filters).toContainEqual(["in", "status", ["draft", "submitted", "countered"]]);

    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: "deal.post_close_cleanup", entityId: "deal1", tenantId: "t1" });
  });

  it("yıldönümü doluysa (güncellenen satır yok) dokunulmaz; değişiklik yoksa audit yazılmaz", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "customer_demands") return { data: [] };
      return { data: c.table === "appointments" || c.table === "offers" ? [] : null };
    });
    const s = await runPostCloseCleanup({
      db, tenantId: "t1", actorId: "u1", dealId: "deal1", dealType: "rent", customerId: "c1", propertyId: null, now: NOW,
    });
    expect(s.anniversary).toBeNull();
    expect(s.closedDemands).toEqual([]);
    expect(calls.some((c) => c.table === "appointments")).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("notifyPostCloseAdvisors", () => {
  it("danışman başına tek, dedupe anahtarlı bildirim; işlemi yapana yazmaz", async () => {
    const { db } = fakeDb((c) => {
      if (c.table === "appointments") return { data: [{ id: "a2", customer_id: "c9", assigned_to: "u2", created_by: "u1" }] };
      if (c.table === "offers") return { data: [{ id: "o1", customer_id: "c9", created_by: "u1" }] };
      if (c.table === "properties") return { data: { property_code: "P-7", title: "Daire" } };
      return { data: null };
    });
    const sent = await notifyPostCloseAdvisors({
      db,
      tenantId: "t1",
      actorId: "u1",
      summary: {
        dealId: "deal1", dealType: "sale", customerId: "c1", propertyId: "p1",
        closedDemands: [], anniversary: null, appointmentIds: ["a2"], offerIds: ["o1"],
      },
    });
    expect(sent).toBe(1);
    expect(notifyTenant).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t1",
      userId: "u2",
      title: "Portföy satıldı: P-7 · Daire",
      dedupeKey: "deal-post-close:deal1:u2",
      prefKey: "appointment",
    }));
  });

  it("kalan kayıt yoksa sorgu/bildirim yok", async () => {
    const { db, calls } = fakeDb(() => ({ data: null }));
    const sent = await notifyPostCloseAdvisors({
      db, tenantId: "t1", actorId: "u1",
      summary: { dealId: "d", dealType: "sale", customerId: null, propertyId: "p1", closedDemands: [], anniversary: null, appointmentIds: [], offerIds: [] },
    });
    expect(sent).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
