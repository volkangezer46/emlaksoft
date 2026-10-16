import { describe, expect, it } from "vitest";
import { groupDuplicateRows, type DuplicateRow } from "./duplicate-groups";

const row = (signal: DuplicateRow["signal"], key: string, id: string, name = "Ayşe Demir"): DuplicateRow => ({
  signal,
  match_key: key,
  customer_id: id,
  full_name: name,
  phone: "05332223344",
  email: null,
  created_at: "2026-10-14T10:00:00Z",
  assigned_to: null,
  activity: 0,
});

describe("groupDuplicateRows", () => {
  it("telefon grubunun kapsadığı ad grubunu tekrar önermez", () => {
    const groups = groupDuplicateRows([
      row("name", "ayse demir", "a"),
      row("name", "ayse demir", "b"),
      row("phone", "05332223344", "a"),
      row("phone", "05332223344", "b"),
    ]);
    expect(groups.map((g) => g.signal)).toEqual(["phone"]);
  });

  it("ad grubu ek bir kayıt içeriyorsa kalır ve gerçek adla başlıklanır", () => {
    const groups = groupDuplicateRows([
      row("phone", "05332223344", "a"),
      row("phone", "05332223344", "b"),
      row("name", "ayse demir", "a", "Ayşe Demir"),
      row("name", "ayse demir", "c", "AYŞE DEMİR"),
    ]);
    expect(groups.map((g) => [g.signal, g.label])).toEqual([
      ["phone", "05332223344"],
      ["name", "Ayşe Demir"],
    ]);
  });

  it("tek kayıtlı grup ve aynı kaydın tekrarı listelenmez", () => {
    expect(groupDuplicateRows([row("email", "x@y.com", "a"), row("email", "x@y.com", "a")])).toEqual([]);
  });
});
