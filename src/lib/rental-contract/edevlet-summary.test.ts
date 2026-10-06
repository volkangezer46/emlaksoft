import { describe, expect, it } from "vitest";
import { buildEdevletCopyText, buildEdevletFields, leaseMonths } from "./edevlet-summary";

const input = {
  propertyCode: "P-102",
  propertyTitle: "Moda 2+1",
  addressLine: "Moda Cd. 10",
  district: "Kadıköy",
  province: "İstanbul",
  renterName: "Ayşe Yılmaz",
  monthlyRent: 32500,
  dueDay: 5,
  startDate: "2026-10-01",
  endDate: "2027-10-01",
  deposit: 65000,
};

describe("e-Devlet kira aktarım özeti", () => {
  it("süre ay olarak hesaplanır; bitiş yoksa null", () => {
    expect(leaseMonths("2026-10-01", "2027-10-01")).toBe(12);
    expect(leaseMonths("2026-10-15", "2027-10-01")).toBe(11);
    expect(leaseMonths("2026-10-01", null)).toBeNull();
  });

  it("alanlar kira kaydından gelir, TC kimlik tutulmaz notu var", () => {
    const fields = buildEdevletFields(input);
    expect(fields.find((f) => f.label === "Süre")?.value).toBe("12 ay");
    expect(fields.find((f) => f.label === "Başlangıç tarihi")?.value).toBe("01.10.2026");
    expect(fields.find((f) => f.label === "TC kimlik numaraları")?.value).toMatch(/tutulmaz/);
    const text = buildEdevletCopyText(input);
    expect(text).toContain("Kadıköy");
    expect(text).not.toMatch(/\b\d{11}\b/);
  });
});
