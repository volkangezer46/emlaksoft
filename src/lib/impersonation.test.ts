import { describe, expect, it } from "vitest";
import { restoreImpersonationMetadata } from "./impersonation";

describe("impersonation metadata restore", () => {
  it("restores a platform account whose home tenant is null", () => {
    const restored = restoreImpersonationMetadata(
      {
        provider: "email",
        tenant_id: "target-tenant",
        role: "readonly",
        impersonating: true,
        home_tenant_id: null,
        home_role: null,
        impersonation_session_id: "session-1",
      },
      { provider: "email" },
    );

    expect(restored).toMatchObject({
      provider: "email",
      tenant_id: null,
      role: null,
      impersonating: false,
      home_tenant_id: null,
      home_role: null,
      impersonation_session_id: null,
    });
  });

  it("preserves the exact original tenant and role when they existed", () => {
    const restored = restoreImpersonationMetadata(
      { tenant_id: "target", role: "readonly", impersonating: true },
      { tenant_id: "home", role: "owner", impersonating: false, custom: "kept" },
    );
    expect(restored.tenant_id).toBe("home");
    expect(restored.role).toBe("owner");
    expect(restored.impersonating).toBe(false);
    expect(restored.custom).toBe("kept");
  });
});
