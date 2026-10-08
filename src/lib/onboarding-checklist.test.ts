import { describe, expect, it } from "vitest";
import {
  buildOnboarding,
  resolveWizardStep,
  wizardNeighbors,
  type OnboardingCounts,
} from "./onboarding-checklist";
import { computeProfileCompletion, isOfficeProfileDone, type ProfileFacts } from "./profile-completion";

const empty: OnboardingCounts = {
  officeProfileDone: false,
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

  it("ofis adımı TEK ilerleme modelinden türer: profil-tamamlama (ekip hariç) tamamsa adım tamam", () => {
    const facts: ProfileFacts = {
      provinceId: "p", districtId: "d", addressLine: "Bağdat Cad. No:42 Kadıköy", phone: "05321234567", licenseNo: "L-1",
      taxNumber: "1234567890", logoUrl: "x", brandColor: "#123456", extAvailable: true, officeType: "ofis",
      focusSegments: ["konut"], workDistrictIds: ["d"], memberCount: 1,
    };
    // Ekip daveti eksik olsa da (kurulumda ayrı adım) ofis adımı tamam sayılır.
    expect(isOfficeProfileDone(computeProfileCompletion(facts))).toBe(true);
    expect(isOfficeProfileDone(computeProfileCompletion({ ...facts, phone: null }))).toBe(false);
    expect(buildOnboarding({ ...empty, officeProfileDone: true }).steps[0].done).toBe(true);
    expect(buildOnboarding(empty).steps[0].done).toBe(false);
  });

  it("yüzde ve sonraki adım gerçek veriden hesaplanır", () => {
    const s = buildOnboarding({
      ...empty,
      customers: 3,
      properties: 1,
      officeProfileDone: true,
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
      officeProfileDone: true,
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
