import { describe, expect, it } from "vitest";
import { assignableRolesFor, canManageRole } from "./assignable-roles";

describe("rol atama kuralı", () => {
  it("owner hiç kimse tarafından atanamaz", () => {
    for (const actor of ["owner", "gm", "branch_manager", "advisor"]) {
      expect(canManageRole(actor, "owner")).toBe(false);
    }
  });
  it("kimse kendi seviyesinden yüksek/eşit yönetici rolü veremez", () => {
    expect(canManageRole("branch_manager", "gm")).toBe(false);
    expect(canManageRole("branch_manager", "branch_manager")).toBe(false);
    expect(canManageRole("gm", "gm")).toBe(false);
    expect(canManageRole("owner", "gm")).toBe(true);
  });
  it("yönetici olmayan rol atayamaz", () => {
    expect(assignableRolesFor("advisor")).toEqual([]);
    expect(canManageRole("team_lead", "advisor")).toBe(false);
  });
});
