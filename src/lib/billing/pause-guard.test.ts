import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlanSupport = vi.fn();
vi.mock("@/lib/billing/plan-support", () => ({ getPlanSupport: () => getPlanSupport() }));
const isPauseEnabled = vi.fn();
vi.mock("@/lib/billing/plan-change", () => ({ isPauseEnabled: () => isPauseEnabled() }));

let pausedRow: { pause_started_at: string | null } | null = null;
let selectError: { message: string } | null = null;
const fromSpy = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => {
      fromSpy(t);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: pausedRow, error: selectError });
      return chain;
    },
  }),
}));
// React cache() testte her çağrıda yeniden hesaplamasın.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { PAUSE_BLOCK_MESSAGE } from "@/lib/billing/pause-core";
import { pausedWriteBlock } from "@/lib/billing/pause-guard";

beforeEach(() => {
  getPlanSupport.mockReset();
  getPlanSupport.mockResolvedValue({ pauseReady: true });
  isPauseEnabled.mockReset();
  isPauseEnabled.mockResolvedValue(true);
  fromSpy.mockClear();
  pausedRow = { pause_started_at: "2026-10-07T00:00:00Z" };
  selectError = null;
});

describe("duraklatılmış abonelikte salt-okunur kapı", () => {
  it("duraklatma bayrağı kapalıyken sorgu atılmaz", async () => {
    isPauseEnabled.mockResolvedValue(false);
    expect(await pausedWriteBlock("t1", "customers", "create")).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });
  it("yazma eylemi reddedilir", async () => {
    expect(await pausedWriteBlock("t1", "customers", "create")).toBe(PAUSE_BLOCK_MESSAGE);
    expect(await pausedWriteBlock("t1", "properties", "delete")).toBe(PAUSE_BLOCK_MESSAGE);
  });

  it("okuma ve abonelik/ödeme modülü DB'ye bile gitmeden serbest", async () => {
    expect(await pausedWriteBlock("t1", "customers", "view")).toBeNull();
    expect(await pausedWriteBlock("t1", "billing", "edit")).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("duraklatılmamış ofis serbest", async () => {
    pausedRow = { pause_started_at: null };
    expect(await pausedWriteBlock("t1", "customers", "create")).toBeNull();
  });

  it("şema hazır değilse (migration yok) hiç sorgu atılmaz ve engellenmez", async () => {
    getPlanSupport.mockResolvedValue({ pauseReady: false });
    expect(await pausedWriteBlock("t1", "customers", "create")).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("okuma hatasında kapı AÇIK kalır (ofis kilitlenmez)", async () => {
    selectError = { message: "boom" };
    expect(await pausedWriteBlock("t1", "customers", "create")).toBeNull();
  });
});
