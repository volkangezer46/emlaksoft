import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const insertMock = vi.fn();
const logMock = vi.fn();
vi.mock("@/lib/sample-data-seed", () => ({
  insertSampleRecords: (...a: unknown[]) => insertMock(...a),
  SAMPLE_DATA_COUNTS: { customers: 12 },
}));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logMock(...a) }));

import { seedDemoDataForNewTenant, wantsDemoData } from "./sample-registration-seed";

function fakeDb(markError: unknown = null) {
  const updates: { payload: Record<string, unknown>; id: unknown }[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("tenants");
      return {
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ payload, id });
            return Promise.resolve({ error: "sample_seeded_at" in payload ? markError : null });
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

beforeEach(() => {
  insertMock.mockReset();
  logMock.mockReset();
});

describe("wantsDemoData", () => {
  it("işaretli kutu (on) demo ister; alan yoksa istemez", () => {
    const f = new FormData();
    expect(wantsDemoData(f)).toBe(false);
    f.set("demo_data", "on");
    expect(wantsDemoData(f)).toBe(true);
    f.set("demo_data", "off");
    expect(wantsDemoData(f)).toBe(false);
  });
});

describe("seedDemoDataForNewTenant", () => {
  it("yalnız verilen tenant'a yükler, damgalar ve etkinlik günlüğüne yazar", async () => {
    insertMock.mockResolvedValue({ counts: { customers: 12 }, skipped: [], failed: [] });
    const { db, updates } = fakeDb();
    const res = await seedDemoDataForNewTenant(db, "t-1", "u-1");
    expect(res.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(db, "t-1", "u-1", { extrasDb: db, pack: "konut" });
    expect(updates.every((u) => u.id === "t-1")).toBe(true);
    expect(updates[0].payload).toHaveProperty("sample_seeded_at");
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t-1", actorId: "u-1", action: "sample_data.seed" }),
    );
  });

  it("yükleme hatasını yutar (kayıt akışı bozulmaz) ve ok=false döner", async () => {
    insertMock.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb();
    expect((await seedDemoDataForNewTenant(db, "t-1", "u-1")).ok).toBe(false);
    expect(logMock).not.toHaveBeenCalled();
  });

  it("damga yazılamazsa günlüğe yazmaz ve ok=false döner", async () => {
    insertMock.mockResolvedValue({ counts: {}, skipped: [], failed: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ message: "x" });
    expect((await seedDemoDataForNewTenant(db, "t-1", "u-1")).ok).toBe(false);
    expect(logMock).not.toHaveBeenCalled();
  });
});

describe("kayıt demo veri sözleşmesi", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("signUp provizyondan SONRA, aynı admin client ile ve yeni createAdminClient çağrısı eklemeden tohumlar", () => {
    const src = read("src/app/actions/auth.ts");
    const fn = src.slice(src.indexOf("export async function signUp"), src.indexOf("export async function signOut"));
    expect(fn.indexOf("provision_registration")).toBeLessThan(fn.indexOf("seedDemoDataForNewTenant(admin"));
    expect(fn.match(/createAdminClient\(\)/g)).toHaveLength(1);
    expect(fn).toContain("wantsDemoData(formData)");
  });

  it("kayıt formunda 'Örnek veriyle başla' kutusu varsayılan açıktır", () => {
    const src = read("src/app/kayit/register-form.tsx");
    expect(src).toMatch(/name="demo_data"\s+defaultChecked/);
    expect(src).toContain("Örnek veriyle başla");
  });

  it("geri dönüş: temizleme yalnız is_sample + tenant_id ile ve izin kapılı", () => {
    const clear = read("src/lib/sample-clear.ts");
    expect(clear).toContain('.eq("tenant_id", tenantId)');
    expect(clear).toContain('.eq("is_sample", true)');
    const action = read("src/app/actions/sample-data.ts");
    expect(action).toMatch(/clearSampleData[\s\S]*requirePermission\("settings", "edit"\)/);
    expect(action).toContain("sample_data.clear");
  });
});
