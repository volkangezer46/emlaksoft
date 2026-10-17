import { describe, expect, it } from "vitest";
import { defaultTitleForRole, resolveInviteTitle } from "./default-title";

describe("davette unvan isteğe bağlı (C25)", () => {
  it("boş unvan rolden gelir", () => {
    expect(resolveInviteTitle("", "advisor")).toBe("Gayrimenkul Danışmanı");
    expect(resolveInviteTitle("  ", "advisor")).toBe("Gayrimenkul Danışmanı");
    expect(resolveInviteTitle("Kıdemli Danışman", "advisor")).toBe("Kıdemli Danışman");
    expect(defaultTitleForRole("team_lead").length).toBeGreaterThan(1);
  });
});
