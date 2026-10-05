import { describe, expect, it } from "vitest";
import {
  buildOnboarding,
  isProfileComplete,
  resolveWizardStep,
  wizardNeighbors,
  type OnboardingCounts,
} from "./onboarding-checklist";

const empty: OnboardingCounts = {
  profileFilled: { phone: false, city: false, licenseNo: false },
  customers: 0,
  properties: 0,
  members: 1,
  activeIntegrations: 0,
  customDefinitions: 0,
  publishedProperties: 0,
  demands: 0,
  appointments: 0,
};

describe("onboarding-checklist", () => {
  it("boş ofis: %0, ilk adım ofis bilgileri", () => {
    const s = buildOnboarding(empty);
    expect(s.percent).toBe(0);
    expect(s.nextId).toBe("office");
    expect(s.total).toBe(8);
    expect(s.complete).toBe(false);
    expect(s.settled).toBe(false);
  });

  it("profil için en az iki alan gerekir", () => {
    expect(isProfileComplete({ phone: true, city: false, licenseNo: false })).toBe(false);
    expect(isProfileComplete({ phone: true, city: true, licenseNo: false })).toBe(true);
  });

  it("yüzde ve sonraki adım gerçek veriden hesaplanır", () => {
    const s = buildOnboarding({
      ...empty,
      customers: 3,
      properties: 1,
      profileFilled: { phone: true, city: true, licenseNo: false },
    });
    expect(s.doneCount).toBe(3);
    expect(s.percent).toBe(38);
    expect(s.nextId).toBe("team");
  });

  it("atlanan adım sonraki adım seçilmez ama tamamlanmış sayılmaz", () => {
    const s = buildOnboarding(empty, ["office"]);
    expect(s.nextId).toBe("team");
    expect(s.steps[0].done).toBe(false);
    expect(s.doneCount).toBe(0);
  });

  it("hepsi atlanınca settled, complete değil", () => {
    const s = buildOnboarding(empty, ["office", "team", "data", "property", "demand", "appointment", "defs", "portals"]);
    expect(s.nextId).toBeNull();
    expect(s.settled).toBe(true);
    expect(s.complete).toBe(false);
  });

  it("tüm adımlar dolu: complete", () => {
    const s = buildOnboarding({
      profileFilled: { phone: true, city: true, licenseNo: true },
      customers: 1,
      properties: 1,
      members: 2,
      activeIntegrations: 0,
      customDefinitions: 2,
      publishedProperties: 1,
      demands: 1,
      appointments: 1,
    });
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(resolveWizardStep(undefined, s)).toBe("bitis");
  });

  it("adım çözümü: geçerli istek kazanır, geçersiz sıradakine düşer", () => {
    const s = buildOnboarding(empty);
    expect(resolveWizardStep("data", s)).toBe("data");
    expect(resolveWizardStep("bitis", s)).toBe("bitis");
    expect(resolveWizardStep("yok", s)).toBe("office");
  });

  it("ilk talep ve ilk randevu adımları gerçek sayıdan tamamlanır", () => {
    const s = buildOnboarding({ ...empty, demands: 2 });
    expect(s.steps.find((x) => x.id === "demand")?.done).toBe(true);
    expect(s.steps.find((x) => x.id === "appointment")?.done).toBe(false);
    expect(buildOnboarding({ ...empty, appointments: 1 }).steps.find((x) => x.id === "appointment")?.done).toBe(true);
  });

  it("geri/ileri komşuları", () => {
    expect(wizardNeighbors("property")).toEqual({ prev: "data", next: "demand" });
    expect(wizardNeighbors("office")).toEqual({ prev: null, next: "team" });
    expect(wizardNeighbors("portals")).toEqual({ prev: "defs", next: "bitis" });
    expect(wizardNeighbors("bitis")).toEqual({ prev: "portals", next: null });
  });
});
