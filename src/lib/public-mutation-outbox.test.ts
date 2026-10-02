import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  pendingResult: { count: 0, error: null as { code?: string } | null },
  deadLetterResult: { count: 0, error: null as { code?: string } | null },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: db.rpc,
    from: (table: string) => {
      if (table !== "public_mutation_outbox") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          in: () => Promise.resolve(db.pendingResult),
          eq: () => Promise.resolve(db.deadLetterResult),
        }),
      };
    },
  }),
}));

import { processPublicMutationOutbox } from "@/lib/public-mutation-outbox";

const CLAIM = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  lease_token: "33333333-3333-4333-8333-333333333333",
};

describe("public mutation outbox worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.pendingResult = { count: 3, error: null };
    db.deadLetterResult = { count: 1, error: null };
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "prune_public_mutation_effects") return { data: 2, error: null };
      if (name === "claim_public_mutation_effects") return { data: [CLAIM], error: null };
      if (name === "complete_public_mutation_effect") {
        return { data: { applied: true, reason: "preference_disabled" }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
  });

  it("completes a leased job and reports operational backlog", async () => {
    await expect(processPublicMutationOutbox(500)).resolves.toEqual({
      claimed: 1,
      completed: 1,
      preferenceDisabled: 1,
      retried: 0,
      deadLettered: 0,
      leaseLost: 0,
      pendingBacklog: 3,
      deadLetterBacklog: 1,
      pruned: 2,
    });

    expect(db.rpc).toHaveBeenCalledWith("claim_public_mutation_effects", {
      p_limit: 100,
      p_lease_seconds: 300,
      p_max_attempts: 8,
    });
    expect(db.rpc).toHaveBeenCalledWith("complete_public_mutation_effect", {
      p_id: CLAIM.id,
      p_tenant_id: CLAIM.tenant_id,
      p_lease_token: CLAIM.lease_token,
    });
  });

  it("moves a failed completion to the database-owned retry state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "prune_public_mutation_effects") return { data: 0, error: null };
      if (name === "claim_public_mutation_effects") return { data: [CLAIM], error: null };
      if (name === "complete_public_mutation_effect") {
        return { data: null, error: { code: "55000" } };
      }
      if (name === "fail_public_mutation_effect") {
        return { data: { applied: true, state: "retry" }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const result = await processPublicMutationOutbox(1);
    expect(result.retried).toBe(1);
    expect(db.rpc).toHaveBeenCalledWith("fail_public_mutation_effect", {
      p_id: CLAIM.id,
      p_tenant_id: CLAIM.tenant_id,
      p_lease_token: CLAIM.lease_token,
      p_error_code: "completion_rpc_failed",
      p_max_attempts: 8,
    });
    consoleError.mockRestore();
  });

  it.each([
    "notification_target_unavailable",
    "notification_dedupe_conflict",
  ])("counts %s as a dead letter rather than a lost lease", async (reason) => {
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "prune_public_mutation_effects") return { data: 0, error: null };
      if (name === "claim_public_mutation_effects") return { data: [CLAIM], error: null };
      if (name === "complete_public_mutation_effect") {
        return {
          data: {
            applied: false,
            state: "dead_letter",
            reason,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    const result = await processPublicMutationOutbox(1);
    expect(result.deadLettered).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.leaseLost).toBe(0);
    expect(db.rpc).not.toHaveBeenCalledWith(
      "fail_public_mutation_effect",
      expect.anything(),
    );
  });

  it("fails closed on a malformed claim so the lease expires for repair", async () => {
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "prune_public_mutation_effects") return { data: 0, error: null };
      if (name === "claim_public_mutation_effects") {
        return { data: [{ ...CLAIM, lease_token: null }], error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(processPublicMutationOutbox()).rejects.toThrow("invalid lease");
  });
});
