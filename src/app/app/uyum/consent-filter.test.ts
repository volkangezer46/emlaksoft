import { describe, expect, it } from "vitest";
import { matchesConsentFilter } from "./consent-filter";

const rows = [
  { channel: "sms", status: "granted" },
  { channel: "sms", status: "pending" },
  { channel: "email", status: "unknown" },
  { channel: "email", status: "denied" },
];

describe("matchesConsentFilter", () => {
  it("Bekleyen süzgeci KPI ile aynı kümeyi verir (bekliyor + bilinmiyor)", () => {
    expect(rows.filter((r) => matchesConsentFilter(r, { durum: "pending" })).length).toBe(2);
  });
  it("diğer durumlar ve kanal birebir", () => {
    expect(rows.filter((r) => matchesConsentFilter(r, { durum: "unknown" })).length).toBe(1);
    expect(rows.filter((r) => matchesConsentFilter(r, { kanal: "email", durum: "pending" })).length).toBe(1);
    expect(rows.filter((r) => matchesConsentFilter(r, {})).length).toBe(4);
  });
});
