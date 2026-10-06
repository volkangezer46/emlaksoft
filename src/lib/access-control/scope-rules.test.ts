/**
 * Kapsam kuralları unit testleri.
 * NOT: Testler DOGRULANMADI - Bu dosya sadece yapıdır.
 */

import { describe, it, expect } from "vitest";
import {
  getDefaultScopeForRole,
  canAdvisorAccessDemand,
  canSignDeal,
  canRejectCommission,
  evaluateScopeAccess,
} from "./scope-rules";
import type { ScopePermissionContext } from "./types";

describe("Scope Rules", () => {
  describe("getDefaultScopeForRole", () => {
    it("owner -> office scope", () => {
      expect(getDefaultScopeForRole("owner")).toBe("office");
    });

    it("gm -> office scope", () => {
      expect(getDefaultScopeForRole("gm")).toBe("office");
    });

    it("branch_manager -> branch scope", () => {
      expect(getDefaultScopeForRole("branch_manager")).toBe("branch");
    });

    it("team_lead -> team scope", () => {
      expect(getDefaultScopeForRole("team_lead")).toBe("team");
    });

    it("advisor -> user scope", () => {
      expect(getDefaultScopeForRole("advisor")).toBe("user");
    });
  });

  describe("canAdvisorAccessDemand", () => {
    const baseContext: ScopePermissionContext = {
      userId: "advisor-1",
      tenantId: "office-1",
      userRole: "advisor",
      userScope: "user",
      targetResourceType: "demand",
      action: "view",
    };

    it("advisor can view own demand", () => {
      const result = canAdvisorAccessDemand({
        ...baseContext,
        targetUserId: "advisor-1",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("user");
    });

    it("advisor cannot edit demand", () => {
      const result = canAdvisorAccessDemand({
        ...baseContext,
        action: "edit",
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("canSignDeal", () => {
    const baseContext: ScopePermissionContext = {
      userId: "user-1",
      tenantId: "office-1",
      userRole: "advisor",
      userScope: "user",
      targetResourceType: "deal",
      action: "sign",
    };

    it("owner can sign deal", () => {
      const result = canSignDeal({
        ...baseContext,
        userRole: "owner",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("office");
    });

    it("gm can sign deal", () => {
      const result = canSignDeal({
        ...baseContext,
        userRole: "gm",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("office");
    });

    it("team_lead can sign deal", () => {
      const result = canSignDeal({
        ...baseContext,
        userRole: "team_lead",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("advisor can sign deal (DB kontrol gerekli)", () => {
      const result = canSignDeal({
        ...baseContext,
        userRole: "advisor",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("user");
    });

    it("call_center cannot sign deal", () => {
      const result = canSignDeal({
        ...baseContext,
        userRole: "call_center",
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("canRejectCommission", () => {
    const baseContext: ScopePermissionContext = {
      userId: "user-1",
      tenantId: "office-1",
      userRole: "advisor",
      userScope: "user",
      targetResourceType: "commission",
      action: "reject",
    };

    it("team_lead can reject commission", () => {
      const result = canRejectCommission({
        ...baseContext,
        userRole: "team_lead",
      });
      expect(result.allowed).toBe(true);
      expect(result.scope).toBe("team");
    });

    it("branch_manager can reject commission", () => {
      const result = canRejectCommission({
        ...baseContext,
        userRole: "branch_manager",
      });
      expect(result.allowed).toBe(true);
    });

    it("owner can reject commission", () => {
      const result = canRejectCommission({
        ...baseContext,
        userRole: "owner",
      });
      expect(result.allowed).toBe(true);
    });

    it("advisor cannot reject commission", () => {
      const result = canRejectCommission({
        ...baseContext,
        userRole: "advisor",
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("evaluateScopeAccess", () => {
    it("evaluates demand access for advisor", () => {
      const context: ScopePermissionContext = {
        userId: "advisor-1",
        tenantId: "office-1",
        userRole: "advisor",
        userScope: "user",
        targetResourceType: "demand",
        targetUserId: "advisor-1",
        action: "view",
      };
      const result = evaluateScopeAccess(context);
      expect(result.allowed).toBe(true);
    });

    it("evaluates deal signing for gm", () => {
      const context: ScopePermissionContext = {
        userId: "gm-1",
        tenantId: "office-1",
        userRole: "gm",
        userScope: "office",
        targetResourceType: "deal",
        action: "sign",
      };
      const result = evaluateScopeAccess(context);
      expect(result.allowed).toBe(true);
    });
  });
});
