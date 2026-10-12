import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Logo/ajan fotoğrafı silme: önce DB (hata kontrolüyle), sonra nesneler kalıcı silme kuyruğuna.
 * DB hatasında nesne kuyruğa girmez ve Türkçe hata döner; kuyruk hatası dürüst uyarı verir (sessiz ok yok).
 */
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  order: [] as string[],
  dbError: null as null | { code: string; message: string },
  enqueueFails: false,
  enqueue: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: async () => ({ ok: true, userId: USER, tenantId: TENANT, role: "owner" }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client kullanılmamalı");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: () => ({
        eq: async () => {
          h.order.push("db");
          return { error: h.dbError };
        },
      }),
    }),
    storage: {
      from: () => ({
        remove: async () => {
          h.order.push("inline-remove");
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/storage-deletion-outbox", () => ({
  enqueueStorageDeletion: async (input: unknown) => {
    h.order.push("enqueue");
    h.enqueue(input);
    if (h.enqueueFails) throw new Error("outbox_down");
  },
}));

import { deleteTenantLogo } from "./tenant-logo";
import { removeAgentPhoto } from "./agent-profile";

beforeEach(() => {
  h.order = [];
  h.dbError = null;
  h.enqueueFails = false;
  h.enqueue.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("deleteTenantLogo", () => {
  it("önce DB, sonra 4 uzantı için outbox; satır içi storage.remove yok", async () => {
    const res = await deleteTenantLogo();
    expect(res).toEqual({ ok: true });
    expect(h.order).toEqual(["db", "enqueue", "enqueue", "enqueue", "enqueue"]);
    const paths = h.enqueue.mock.calls.map((c) => (c[0] as { objectPath: string }).objectPath).sort();
    expect(paths).toEqual(["png", "jpg", "webp", "svg"].map((e) => `${TENANT}/logo.${e}`).sort());
  });

  it("DB hatasında nesne kuyruğa girmez ve Türkçe hata döner", async () => {
    h.dbError = { code: "42501", message: "denied" };
    const res = await deleteTenantLogo();
    expect(res.ok).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(h.order).toEqual(["db"]);
  });

  it("kuyruk hatası sessizce yutulmaz: ok + dürüst uyarı", async () => {
    h.enqueueFails = true;
    const res = await deleteTenantLogo();
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/depodan silinmesi sıraya alınamadı/);
  });
});

describe("removeAgentPhoto", () => {
  const fd = () => {
    const f = new FormData();
    f.set("target_id", USER);
    return f;
  };

  it("önce DB, sonra jpg/png/webp outbox", async () => {
    const res = await removeAgentPhoto(fd());
    expect(res).toEqual({ ok: true });
    expect(h.order).toEqual(["db", "enqueue", "enqueue", "enqueue"]);
    const first = h.enqueue.mock.calls[0][0] as { bucket: string; parentId: string };
    expect(first.bucket).toBe("agent-photos");
    expect(first.parentId).toBe(USER);
  });

  it("DB hatasında nesne kuyruğa girmez (kırık foto_url + silinmiş nesne olmaz)", async () => {
    h.dbError = { code: "42501", message: "denied" };
    const res = await removeAgentPhoto(fd());
    expect(res.error).toBeTruthy();
    expect(h.order).toEqual(["db"]);
  });

  it("kuyruk hatasında dürüst uyarı döner", async () => {
    h.enqueueFails = true;
    const res = await removeAgentPhoto(fd());
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/sıraya alınamadı/);
  });
});
