import { describe, expect, it } from "vitest";
import {
  CONTRACT_STATUS_LABELS,
  contractStatusTone,
  countContractTypes,
  isExpired,
  renewalDays,
  signRate,
} from "./contract-list-logic";

const NOW = Date.UTC(2026, 9, 3, 12);
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("sözleşme liste mantığı", () => {
  it("her durumun tonu var; imza=success red=danger", () => {
    for (const k of Object.keys(CONTRACT_STATUS_LABELS)) expect(contractStatusTone(k)).toBeTruthy();
    expect(contractStatusTone("signed")).toBe("success");
    expect(contractStatusTone("rejected")).toBe("danger");
  });
  it("yenileme: yalnız 0-30 gün, iptal/red hariç", () => {
    expect(renewalDays(day(10), "signed", NOW)).toBe(10);
    expect(renewalDays(day(40), "signed", NOW)).toBeNull();
    expect(renewalDays(day(-2), "signed", NOW)).toBeNull();
    expect(renewalDays(day(10), "cancelled", NOW)).toBeNull();
    expect(renewalDays(null, "signed", NOW)).toBeNull();
  });
  it("süresi dolmuş: geçmiş tarih, iptal/red hariç", () => {
    expect(isExpired(day(-1), "signed", NOW)).toBe(true);
    expect(isExpired(day(1), "signed", NOW)).toBe(false);
    expect(isExpired(day(-1), "rejected", NOW)).toBe(false);
  });
  it("tür dağılımı ve imza oranı", () => {
    expect(countContractTypes([{ contract_type: "kira" }, { contract_type: "kira" }, { contract_type: "satis" }, { contract_type: null }])).toEqual({ kira: 2, satis: 1 });
    expect(signRate(3, 1)).toBe(75);
    expect(signRate(0, 0)).toBeNull();
  });
});
