import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/notify.ts", "utf8");

describe("notification tenant boundary", () => {
  it("verifies targeted users inside the active tenant before service-role writes", () => {
    expect(source).toContain('.eq("id", input.userId)');
    expect(source).toContain('.eq("tenant_id", input.tenantId)');
    expect(source).toContain('.eq("is_active", true)');
    expect(source).toContain("if (!profile) throw");
  });

  it("does not silently lose preference reads or notification inserts", () => {
    expect(source).toContain("if (profileError) throw");
    expect(source).toContain("if (notificationError) throw");
  });
});
