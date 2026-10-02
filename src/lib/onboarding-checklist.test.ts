import { describe, expect, it } from "vitest";
import { buildOnboarding, isProfileComplete, type OnboardingCounts } from "./onboarding-checklist";

const empty: OnboardingCounts = {
  profileFilled: { phone: false, city: false, licenseNo: false },
  customers: 0,
  properties: 0,
  members: 1,
  activeIntegrations: 0,
};

describe("onboarding-checklist", () => {
  it("boş ofis: %0, ilk adım profil", () => {
    const s = buildOnboarding(empty);
    expect(s.percent).toBe(0);
    expect(s.nextId).toBe("profile");
    expect(s.total).toBe(5);
    expect(s.complete).toBe(false);
  });

  it("profil için en az iki alan gerekir", () => {
    expect(isProfileComplete({ phone: true, city: false, licenseNo: false })).toBe(false);
    expect(isProfileComplete({ phone: true, city: true, licenseNo: false })).toBe(true);
  });

  it("yüzde ve sonraki adım ilerlemeyi izler", () => {
    const s = buildOnboarding({
      ...empty,
      customers: 3,
      properties: 1,
      profileFilled: { phone: true, city: true, licenseNo: false },
    });
    expect(s.doneCount).toBe(3);
    expect(s.percent).toBe(60);
    expect(s.nextId).toBe("team");
  });

  it("atlanan adım sonraki adım seçilmez ama tamamlanmış sayılmaz", () => {
    const s = buildOnboarding(empty, ["profile"]);
    expect(s.nextId).toBe("customer");
    expect(s.steps[0].done).toBe(false);
  });

  it("hepsi bitince complete ve nextId null", () => {
    const s = buildOnboarding({
      profileFilled: { phone: true, city: true, licenseNo: true },
      customers: 1,
      properties: 1,
      members: 2,
      activeIntegrations: 1,
    });
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(s.nextId).toBeNull();
  });

  it("her adımın hedefi /app ile başlar", () => {
    for (const st of buildOnboarding(empty).steps) expect(st.href.startsWith("/app/")).toBe(true);
  });
});
