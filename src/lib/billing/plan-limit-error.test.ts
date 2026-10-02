import { describe, expect, it } from "vitest";
import { planLimitErrorMessage } from "./plan-limit-error";

describe("planLimitErrorMessage", () => {
  it("turns database capacity errors into actionable Turkish copy", () => {
    expect(planLimitErrorMessage({ message: "PLAN_LIMIT_EXCEEDED:customers:1000" })).toBe(
      "Paketiniz en fazla 1000 müşteri destekliyor. Devam etmek için paketinizi yükseltin.",
    );
  });

  it("does not hide unrelated database failures", () => {
    expect(planLimitErrorMessage({ message: "duplicate key" })).toBeNull();
  });
});
