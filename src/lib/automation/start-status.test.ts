import { describe, expect, it } from "vitest";
import { automationStartStatus } from "./start-status";

describe("automationStartStatus", () => {
  it("yalnız açık '0' pasif kaydeder", () => {
    expect(automationStartStatus("0")).toBe("inactive");
    expect(automationStartStatus("1")).toBe("active");
    expect(automationStartStatus(null)).toBe("active");
    expect(automationStartStatus(undefined)).toBe("active");
  });
});
