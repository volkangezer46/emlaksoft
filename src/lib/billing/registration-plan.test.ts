import { describe, expect, it } from "vitest";
import {
  defaultTeamSizeForPlan,
  minimumPlanForTeamSize,
  normalizeRegistrationTeamSize,
  registrationPlanForTeamSize,
} from "@/lib/billing/registration-plan";

describe("registration plan compatibility", () => {
  it("maps each team-size answer to its minimum viable plan", () => {
    expect(minimumPlanForTeamSize("1")).toBe("advisor");
    expect(minimumPlanForTeamSize("2-10")).toBe("office");
    expect(minimumPlanForTeamSize("10-50")).toBe("professional");
    expect(minimumPlanForTeamSize("50+")).toBe("enterprise");
  });

  it("upgrades an undersized requested plan", () => {
    expect(registrationPlanForTeamSize("advisor", "2-10")).toBe("office");
    expect(registrationPlanForTeamSize("office", "50+")).toBe("enterprise");
  });

  it("preserves an intentional higher-tier selection", () => {
    expect(registrationPlanForTeamSize("enterprise", "1")).toBe("enterprise");
    expect(registrationPlanForTeamSize("professional", "2-10")).toBe("professional");
  });

  it("uses safe defaults for tampered registration values", () => {
    expect(normalizeRegistrationTeamSize("unknown")).toBe("2-10");
    expect(registrationPlanForTeamSize("unknown", "50+")).toBe("enterprise");
    expect(defaultTeamSizeForPlan("professional")).toBe("10-50");
  });
});
