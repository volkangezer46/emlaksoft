import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  createClient: vi.fn(),
  logActivity: vi.fn(),
  usage: vi.fn(),
  row: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  deleted: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: mocks.gate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/definition-usage", () => ({ countDefinitionUsage: mocks.usage }));

import { deleteDefinition, toggleDefinition, setDefinitionColor } from "@/app/actions/definitions";

const ID = "123e4567-e89b-42d3-a456-426614174000";

function client() {
  return {
    from: () => {
      let mode: "select" | "update" | "delete" = "select";
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.update = (patch: Record<string, unknown>) => {
        mode = "update";
        mocks.updates.push(patch);
        return b;
      };
      b.delete = () => {
        mode = "delete";
        mocks.deleted += 1;
        return b;
      };
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: mode === "select" ? mocks.row : { id: ID }, error: null });
      return b;
    },
  };
}

describe("definitions action'ları", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.deleted = 0;
    mocks.row = { id: ID, category: "property_type", value: "Daire", label: "Daire", color: null, sort_order: 1, is_active: true };
    mocks.gate.mockResolvedValue({ ok: true, userId: "u1", tenantId: "t1", role: "owner" });
    mocks.createClient.mockImplementation(async () => client());
    mocks.usage.mockResolvedValue(0);
  });

  it("yetkisiz kullanıcı hiçbir şey yazamaz", async () => {
    mocks.gate.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect(await deleteDefinition(ID)).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(mocks.deleted).toBe(0);
    expect(mocks.gate).toHaveBeenCalledWith("settings", "edit");
  });

  it("kullanımdaki değer silinmez", async () => {
    mocks.usage.mockResolvedValue(3);
    const res = await deleteDefinition(ID);
    expect(res.error).toContain("3 kayıtta kullanılıyor");
    expect(mocks.deleted).toBe(0);
  });

  it("referans sayılamazsa güvenli tarafta engellenir", async () => {
    mocks.usage.mockResolvedValue(null);
    const res = await deleteDefinition(ID);
    expect(res.error).toBeTruthy();
    expect(mocks.deleted).toBe(0);
  });

  it("sistem anahtarı silinemez ve gizlenemez", async () => {
    mocks.row = { ...mocks.row, category: "appointment_type", value: "showing" };
    expect((await deleteDefinition(ID)).error).toContain("sistem");
    expect((await toggleDefinition(ID, false)).error).toContain("sistem");
    expect(mocks.deleted).toBe(0);
    expect(mocks.updates).toHaveLength(0);
  });

  it("kullanılmayan ofis tanımı silinir ve denetim kaydı düşer", async () => {
    const res = await deleteDefinition(ID);
    expect(res.ok).toBe(true);
    expect(mocks.deleted).toBe(1);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", actorId: "u1", action: "definition.delete", entityType: "definition" }),
    );
  });

  it("renk biçimi doğrulanır ve kaydedilince loglanır", async () => {
    expect((await setDefinitionColor(ID, "kirmizi")).error).toContain("#rrggbb");
    expect(mocks.updates).toHaveLength(0);
    expect((await setDefinitionColor(ID, "#10b981")).ok).toBe(true);
    expect(mocks.updates[0]).toEqual({ color: "#10b981" });
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "definition.color" }));
  });

  it("geçersiz id reddedilir", async () => {
    expect((await deleteDefinition("x")).error).toBeTruthy();
    expect(mocks.deleted).toBe(0);
  });
});
