import { describe, expect, it } from "vitest";
import { SCOPE_MEMBER_CAP, applyScopeFilter, resolveScopeFilter, scopeBadgeText, tightenScopeFilter } from "./query-scope";

type Call = { op: "eq" | "in"; column: string; value: unknown };
class FakeQuery {
  calls: Call[] = [];
  eq(column: string, value: string) {
    this.calls.push({ op: "eq", column, value });
    return this;
  }
  in(column: string, values: readonly string[]) {
    this.calls.push({ op: "in", column, value: values });
    return this;
  }
}

const scope = (t: "user" | "team" | "branch" | "office" | "platform", ctx: { team_id?: string | null; branch_id?: string | null } = {}) => ({
  scope_type: t,
  user_id: "me",
  team_id: ctx.team_id ?? null,
  branch_id: ctx.branch_id ?? null,
});

describe("resolveScopeFilter", () => {
  it("office/platform süzgeç yok; user = self", () => {
    expect(resolveScopeFilter(scope("office"), null)).toEqual({ kind: "none" });
    expect(resolveScopeFilter(scope("platform"), ["x"])).toEqual({ kind: "none" });
    expect(resolveScopeFilter(scope("user"), ["x"])).toEqual({ kind: "self", userId: "me" });
  });

  it("team/branch üye listesi + self; bağlam yoksa fail-closed self", () => {
    expect(resolveScopeFilter(scope("team", { team_id: "t1" }), ["a", "b", "me"])).toEqual({ kind: "members", ids: ["me", "a", "b"] });
    expect(resolveScopeFilter(scope("team"), ["a"])).toEqual({ kind: "self", userId: "me" });
    expect(resolveScopeFilter(scope("branch", { branch_id: "b1" }), [])).toEqual({ kind: "self", userId: "me" });
    expect(resolveScopeFilter(scope("branch", { branch_id: "b1" }), ["z"])).toEqual({ kind: "members", ids: ["me", "z"] });
  });

  it("üye listesi tavanla sınırlanır, self her zaman içeride", () => {
    const many = Array.from({ length: SCOPE_MEMBER_CAP + 50 }, (_, i) => `u${i}`);
    const f = resolveScopeFilter(scope("branch", { branch_id: "b1" }), many);
    expect(f.kind).toBe("members");
    if (f.kind === "members") {
      expect(f.ids).toHaveLength(SCOPE_MEMBER_CAP);
      expect(f.ids[0]).toBe("me");
    }
  });
});

describe("tightenScopeFilter: kapsam yalnız daraltır", () => {
  it("eski kural 'kendi kayıtları' derse kapsam genişletemez", () => {
    expect(tightenScopeFilter({ kind: "none" }, { mineOnly: true, userId: "me" })).toEqual({ kind: "self", userId: "me" });
    expect(tightenScopeFilter({ kind: "members", ids: ["me", "a"] }, { mineOnly: true, userId: "me" })).toEqual({ kind: "self", userId: "me" });
  });
  it("eski kural ofis geneli ise kapsam uygulanır", () => {
    expect(tightenScopeFilter({ kind: "members", ids: ["me", "a"] }, { mineOnly: false, userId: "me" })).toEqual({ kind: "members", ids: ["me", "a"] });
  });
});

describe("applyScopeFilter", () => {
  it("none dokunmaz, self eq, members in (gömülü sütun dahil)", () => {
    expect(applyScopeFilter(new FakeQuery(), { kind: "none" }, { ownerColumn: "assigned_to" }).calls).toEqual([]);
    expect(applyScopeFilter(new FakeQuery(), { kind: "self", userId: "me" }, { ownerColumn: "assigned_to" }).calls).toEqual([
      { op: "eq", column: "assigned_to", value: "me" },
    ]);
    expect(applyScopeFilter(new FakeQuery(), { kind: "members", ids: ["me", "a"] }, { ownerColumn: "customer.assigned_to" }).calls).toEqual([
      { op: "in", column: "customer.assigned_to", value: ["me", "a"] },
    ]);
  });
});

describe("scopeBadgeText", () => {
  it("daraltmıyorsa null; takım/şube adı eklenir", () => {
    expect(scopeBadgeText("office", { kind: "none" }, {})).toBeNull();
    expect(scopeBadgeText("user", { kind: "self", userId: "me" }, {})).toBe("Kapsam: Kendi kayıtlarım");
    expect(scopeBadgeText("team", { kind: "members", ids: ["me"] }, { teamName: "Satış A" })).toBe("Kapsam: Takım (Satış A)");
    expect(scopeBadgeText("branch", { kind: "members", ids: ["me"] }, {})).toBe("Kapsam: Şube");
  });
});
