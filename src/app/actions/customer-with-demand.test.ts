import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionKey, SubmissionStore } from "@/lib/field-capture/submission-guard";

/**
 * SK7 / B091 + B092 + B033: müşteri formu eylemi.
 *  - Aynı telefonla farklı kişi "Yine de yeni kayıt" (allow_duplicate=1) ile GERÇEKTEN ikinci müşteri olarak açılır
 *    (eski 30 sn sezgisi eski kaydı döndürüp sessizce yutuyordu).
 *  - Aynı formun çift gönderimi (aynı client_request_id) tek kayıt yazar.
 *  - Özel alanlar, link_ref ve talep atlanmaz; fren kapanışı yanıt sonrasına (after) kalır.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const deferred: (() => unknown)[] = [];
vi.mock("@/lib/after-safe", () => ({ afterSafe: (task: () => unknown) => void deferred.push(task) }));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: vi.fn(async () => ({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

let inserted: string[] = [];
vi.mock("@/lib/customer-create", async (orig) => {
  const real = await orig<typeof import("@/lib/customer-create")>();
  return {
    ...real,
    insertCustomerRecord: vi.fn(async (_db: unknown, _ctx: unknown, v: { fullName: string }) => {
      const id = `00000000-0000-4000-8000-00000000000${inserted.length + 1}`;
      inserted.push(v.fullName);
      return { ok: true, id };
    }),
  };
});

let existingPhones = new Set<string>();
vi.mock("@/lib/duplicate-finders", async (orig) => {
  const real = await orig<typeof import("@/lib/duplicate-finders")>();
  return {
    ...real,
    assertCustomerNotDuplicate: vi.fn(async (_db: unknown, _ctx: unknown, input: { phone: string }, allow: boolean) =>
      !allow && existingPhones.has(input.phone) ? { duplicate: true, count: 1 } : { duplicate: false },
    ),
  };
});

const writeCf = vi.fn(async () => true);
vi.mock("@/lib/custom-fields/save", () => ({
  prepareCustomFieldInputs: vi.fn(async (_db: unknown, _t: string, _e: string, fd: FormData) => ({
    ok: true,
    value: { rows: fd.get("cf_renk") ? [{ field_id: "f1", value: fd.get("cf_renk") }] : [] },
  })),
  writeCustomFieldInputs: (...args: unknown[]) => writeCf(...(args as [])),
}));
const link = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/actions/communications", () => ({ linkRecordToCustomer: (...a: unknown[]) => link(...(a as [])) }));
const demand = vi.fn(async () => ({ ok: true, id: "d1" }));
vi.mock("@/app/actions/demands", () => ({ createDemand: (...a: unknown[]) => demand(...(a as [])) }));

function memorySubmissions(): SubmissionStore {
  const rows = new Map<string, { completed_at: string | null; result_id: string | null; created_at: string }>();
  const k = (key: SubmissionKey) => `${key.tenantId}|${key.userId}|${key.requestId}`;
  return {
    async claim(key) {
      if (rows.has(k(key))) return { error: { code: "23505" } };
      rows.set(k(key), { completed_at: null, result_id: null, created_at: new Date().toISOString() });
      return { error: null };
    },
    async read(key) {
      return rows.get(k(key)) ?? null;
    },
    async touch() {},
    async complete(key, resultId, at) {
      const r = rows.get(k(key));
      if (r) Object.assign(r, { completed_at: at, result_id: resultId });
    },
    async release(key) {
      if (!rows.get(k(key))?.completed_at) rows.delete(k(key));
    },
    async prune() {},
  };
}
let store = memorySubmissions();
vi.mock("@/lib/field-capture/submission-guard", async (orig) => {
  const real = await orig<typeof import("@/lib/field-capture/submission-guard")>();
  return { ...real, supabaseSubmissionStore: () => store };
});

import { createCustomerWithDemand } from "./customer-with-demand";

const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
async function flushAfter() {
  while (deferred.length) await deferred.shift()!();
}

beforeEach(() => {
  inserted = [];
  existingPhones = new Set();
  store = memorySubmissions();
  deferred.length = 0;
  writeCf.mockClear();
  link.mockClear();
  demand.mockClear();
});

describe("createCustomerWithDemand", () => {
  it("aynı telefonla farklı kişi: onaysız reddedilir, 'Yine de yeni kayıt' ile ikinci müşteri açılır", async () => {
    existingPhones.add("05557314002");
    const first = await createCustomerWithDemand({}, form({ full_name: "Mehmet Yıldırım", phone: "0555 731 40 02", type: "Mülk sahibi", client_request_id: RID }));
    expect(first).toMatchObject({ duplicate: true });
    expect(inserted).toEqual([]);
    // Aynı istek kimliğiyle onaylı yeniden gönderim (ret sonrası fren hemen bırakıldı).
    const second = await createCustomerWithDemand(
      {},
      form({ full_name: "Mehmet Yıldırım", phone: "0555 731 40 02", type: "Mülk sahibi", client_request_id: RID, allow_duplicate: "1" }),
    );
    expect(second.ok).toBe(true);
    expect(inserted).toEqual(["Mehmet Yıldırım"]);
  });

  it("çift tıklama (aynı client_request_id) tek kayıt yazar ve aynı kimliği döndürür", async () => {
    const fd = () => form({ full_name: "Ali Kaya", phone: "0555 111 22 33", type: "Mülk sahibi", client_request_id: RID });
    const a = await createCustomerWithDemand({}, fd());
    await flushAfter(); // kapanış (complete) yanıt sonrası
    const b = await createCustomerWithDemand({}, fd());
    expect(inserted).toEqual(["Ali Kaya"]);
    expect(b).toMatchObject({ ok: true, id: a.id });
  });

  it("özel alan, kaynak kayıt bağı (link_ref) ve talep atlanmaz", async () => {
    const res = await createCustomerWithDemand(
      {},
      form({
        full_name: "Ayşe Demir",
        phone: "0532 999 88 77",
        type: "Alıcı",
        transaction_type: "Satılık",
        budget_max: "5000000",
        cf_renk: "mavi",
        link_ref: "a-0f8fad5b-d9cb-469f-a165-70867728950e",
        client_request_id: RID,
      }),
    );
    expect(res).toMatchObject({ ok: true, demandId: "d1" });
    expect(writeCf).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith("call", "0f8fad5b-d9cb-469f-a165-70867728950e", res.id);
    expect(demand).toHaveBeenCalledTimes(1);
  });

  it("doğrulama hatası ağ turundan önce döner", async () => {
    const res = await createCustomerWithDemand({}, form({ full_name: "  ", phone: "0532 999 88 77" }));
    expect(res.error).toBe("Ad soyad zorunlu.");
    expect(inserted).toEqual([]);
  });
});
