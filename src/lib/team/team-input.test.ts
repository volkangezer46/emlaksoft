import { describe, expect, it } from "vitest";
import { parseTeamInput } from "./team-input";

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseTeamInput", () => {
  it("adı boşlukları sadeleştirip kırpar", () => {
    const r = parseTeamInput(fd({ name: "  Kuzey   Ekibi " }));
    expect(r).toEqual({ ok: true, value: { name: "Kuzey Ekibi", branchId: null, leadUserId: null, isActive: null } });
  });
  it("boş ad ve çok uzun ad reddedilir", () => {
    expect(parseTeamInput(fd({ name: "  " })).ok).toBe(false);
    expect(parseTeamInput(fd({ name: "a".repeat(81) })).ok).toBe(false);
  });
  it("geçersiz uuid reddedilir, boş şube/lider null olur", () => {
    expect(parseTeamInput(fd({ name: "A", lead_user_id: "x" })).ok).toBe(false);
    expect(parseTeamInput(fd({ name: "A", branch_id: "" }))).toMatchObject({ ok: true, value: { branchId: null } });
  });
  it("is_active yalnız gönderilmişse okunur", () => {
    expect(parseTeamInput(fd({ name: "A", is_active: "false" }))).toMatchObject({ value: { isActive: false } });
  });
});
