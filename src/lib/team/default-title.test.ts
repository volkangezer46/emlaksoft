import { describe, expect, it } from "vitest";
import { defaultTitleForRole, resolveInviteTitle } from "./default-title";
import { quickInviteSchema } from "@/lib/office-center/validators";

describe("davette unvan isteğe bağlı (C25)", () => {
  it("boş unvan rolden gelir", () => {
    expect(resolveInviteTitle("", "advisor")).toBe("Gayrimenkul Danışmanı");
    expect(resolveInviteTitle("  ", "advisor")).toBe("Gayrimenkul Danışmanı");
    expect(resolveInviteTitle("Kıdemli Danışman", "advisor")).toBe("Kıdemli Danışman");
    expect(defaultTitleForRole("team_lead").length).toBeGreaterThan(1);
  });

  it("hızlı davet şeması unvansız geçer", () => {
    const r = quickInviteSchema.safeParse({ fullName: "Ayşe Yılmaz", email: "ayse@example.com", role: "advisor" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe("");
  });
});
