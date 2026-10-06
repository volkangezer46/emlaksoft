import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const insertMock = vi.fn();
const logMock = vi.fn();
vi.mock("@/lib/sample-data-seed", () => ({
  insertSampleRecords: (...a: unknown[]) => insertMock(...a),
  SAMPLE_DATA_COUNTS: { customers: 12 },
  SAMPLE_PACKS: ["konut", "ticari", "arsa"],
}));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logMock(...a) }));

import { ensureSampleData, isAlreadySeeded, normalizePack } from "./seed";

/** Bellek içi sahte DB: tenants damgası + is_sample müşteri sayısı; update'ler kaydedilir. */
function fakeDb(state: { seededAt: string | null; sampleCustomers: number; readError?: boolean; markError?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () =>
            state.readError ? { data: null, error: { message: "x" } } : { data: { sample_seeded_at: state.seededAt }, error: null },
          then: (resolve: (v: unknown) => void) =>
            resolve(state.readError ? { count: null, error: { message: "x" } } : { count: opts?.head && table === "customers" ? state.sampleCustomers : 0, error: null }),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(payload);
          if ("sample_seeded_at" in payload) {
            if (state.markError) return { error: { message: "mark" } };
            state.seededAt = String(payload.sample_seeded_at);
          }
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, updates, state };
}

beforeEach(() => {
  insertMock.mockReset();
  logMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ensureSampleData (idempotent)", () => {
  it("boş ofise bir kez yükler; ikinci çağrı HİÇ yazmaz (already_seeded)", async () => {
    insertMock.mockImplementation(async () => ({ counts: { customers: 12 }, skipped: [], failed: [] }));
    const f = fakeDb({ seededAt: null, sampleCustomers: 0 });
    const first = await ensureSampleData(f.db, "t-1", "u-1", { pack: "ticari" });
    expect(first).toMatchObject({ ok: true, skipped: null });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(f.db, "t-1", "u-1", { extrasDb: f.db, pack: "ticari" });
    const second = await ensureSampleData(f.db, "t-1", "u-1", { pack: "ticari" });
    expect(second).toEqual({ ok: true, skipped: "already_seeded", report: null });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it("damga yok ama is_sample müşteri varsa (yarıda kalan eski yükleme) çift set üretmez", async () => {
    const f = fakeDb({ seededAt: null, sampleCustomers: 3 });
    expect(await ensureSampleData(f.db, "t-1", "u-1")).toMatchObject({ skipped: "already_seeded" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("okuma hatasında güvenli taraf: yazmaz", async () => {
    const f = fakeDb({ seededAt: null, sampleCustomers: 0, readError: true });
    expect(await isAlreadySeeded(f.db, "t-1")).toBe(true);
    expect(await ensureSampleData(f.db, "t-1", "u-1")).toMatchObject({ ok: true, skipped: "already_seeded" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("yükleme/damga hatası yutulur: ok=false, günlüğe yazılmaz, fırlatmaz", async () => {
    insertMock.mockRejectedValue(new Error("boom"));
    expect(await ensureSampleData(fakeDb({ seededAt: null, sampleCustomers: 0 }).db, "t-1", "u-1")).toMatchObject({ ok: false });
    insertMock.mockResolvedValue({ counts: {}, skipped: [], failed: [] });
    expect(await ensureSampleData(fakeDb({ seededAt: null, sampleCustomers: 0, markError: true }).db, "t-1", "u-1")).toMatchObject({ ok: false });
    expect(logMock).not.toHaveBeenCalled();
  });

  it("normalizePack geçersiz değerde konut", () => {
    expect(normalizePack("arsa")).toBe("arsa");
    expect(normalizePack("x")).toBe("konut");
    expect(normalizePack(undefined)).toBe("konut");
  });
});
