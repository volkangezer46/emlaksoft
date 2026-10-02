import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, insertMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { logActivity, logActivityOrThrow } from "@/lib/activity";

const input = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  actorId: "00000000-0000-0000-0000-000000000002",
  action: "test.audit",
};

describe("activity audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({ insert: insertMock })),
    });
  });

  it("reports a successful audit insert", async () => {
    insertMock.mockResolvedValue({ error: null });
    await expect(logActivity(input)).resolves.toEqual({ ok: true });
  });

  it("does not silently swallow Supabase result errors", async () => {
    insertMock.mockResolvedValue({ error: { message: "permission denied" } });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logActivity(input)).resolves.toEqual({
      ok: false,
      error: "permission denied",
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("fails closed when the strict audit boundary cannot write", async () => {
    insertMock.mockResolvedValue({ error: { message: "database unavailable" } });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logActivityOrThrow(input)).rejects.toThrow(
      "Kritik işlem audit kaydı oluşturulamadı.",
    );
    consoleSpy.mockRestore();
  });
});
