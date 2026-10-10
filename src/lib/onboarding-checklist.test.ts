import { describe, expect, it } from "vitest";
import {
  buildFirstTasks,
  buildOnboarding,
  resolveWizardStep,
  wizardNeighbors,
  type OnboardingFacts,
} from "./onboarding-checklist";
import { ONBOARDING_STEP_DEFS, ONBOARDING_STEP_IDS, resolveLegacyStep } from "./onboarding-steps";
import { computeProfileCompletion, isOfficeLocationDone, type ProfileFacts } from "./profile-completion";

const empty: OnboardingFacts = {
  officeLocationDone: false,
  youDone: false,
  members: 1,
  poolEnabled: false,
  publishedProperties: 0,
  activeIntegrations: 0,
  planPaid: false,
  extra: {},
};
const full: OnboardingFacts = {
  officeLocationDone: true,
  youDone: true,
  members: 2,
  poolEnabled: true,
  publishedProperties: 1,
  activeIntegrations: 0,
  planPaid: true,
  extra: {},
};

describe("onboarding-steps kaydı", () => {
  it("adım sırası: ofis, sen, ekip, havuz, portallar, giderler ve kasa, paket", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["office", "you", "team", "pool", "portals", "giderler-kasa", "plan"]);
    expect(new Set(ONBOARDING_STEP_IDS).size).toBe(ONBOARDING_STEP_DEFS.length);
  });

  it("eski bağlantılar yeni adıma eşlenir; bilinmeyen null", () => {
    expect(resolveLegacyStep("konum")).toBe("office");
    expect(resolveLegacyStep("odak")).toBe("you");
    expect(resolveLegacyStep("ekip")).toBe("team");
    expect(resolveLegacyStep("data")).toBe("bitis");
    expect(resolveLegacyStep("portals")).toBe("portals");
    expect(resolveLegacyStep("yok")).toBeNull();
    expect(resolveLegacyStep(undefined)).toBeNull();
  });
});

describe("onboarding-checklist", () => {
  it("boş ofis: %0, ilk adım ofis bilgileri", () => {
    const s = buildOnboarding(empty);
    expect(s.percent).toBe(0);
    expect(s.nextId).toBe("office");
    expect(s.total).toBe(7);
    expect(s.complete).toBe(false);
    expect(s.settled).toBe(false);
  });

  it("ofis adımı yalnız konum maddelerinden (il/ilçe + adres) türer; telefon/belge/vergi bloklamaz", () => {
    const facts: ProfileFacts = {
      provinceId: "p", districtId: "d", addressLine: "Bağdat Cad. No:42 Kadıköy", phone: null, licenseNo: null,
      taxNumber: null, logoUrl: null, brandColor: null, extAvailable: true, officeType: null,
      focusSegments: null, workDistrictIds: null, memberCount: 1,
    };
    expect(isOfficeLocationDone(computeProfileCompletion(facts))).toBe(true);
    expect(isOfficeLocationDone(computeProfileCompletion({ ...facts, addressLine: "kısa" }))).toBe(false);
    expect(isOfficeLocationDone(computeProfileCompletion({ ...facts, districtId: null }))).toBe(false);
    expect(buildOnboarding({ ...empty, officeLocationDone: true }).steps[0].done).toBe(true);
    expect(buildOnboarding(empty).steps[0].done).toBe(false);
  });

  it("yüzde ve sonraki adım gerçek veriden hesaplanır", () => {
    const s = buildOnboarding({ ...empty, officeLocationDone: true, youDone: true, poolEnabled: true });
    expect(s.doneCount).toBe(3);
    expect(s.percent).toBe(43);
    expect(s.nextId).toBe("team");
  });

  it("atlanan adım sonraki adım seçilmez ama tamamlanmış sayılmaz", () => {
    const s = buildOnboarding(empty, ["office"]);
    expect(s.nextId).toBe("you");
    expect(s.steps[0].done).toBe(false);
    expect(s.doneCount).toBe(0);
  });

  it("hepsi atlanınca settled, complete değil", () => {
    const s = buildOnboarding(empty, [...ONBOARDING_STEP_IDS]);
    expect(s.nextId).toBeNull();
    expect(s.settled).toBe(true);
    expect(s.complete).toBe(false);
  });

  it("tüm adımlar dolu: complete", () => {
    const s = buildOnboarding({ ...full, extra: { "giderler-kasa": true } });
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(resolveWizardStep(undefined, s)).toBe("bitis");
  });

  it("havuz ve paket adımları gerçek olgudan tamamlanır; portallar yayın ya da entegrasyondan", () => {
    expect(buildOnboarding({ ...empty, poolEnabled: true }).steps.find((x) => x.id === "pool")?.done).toBe(true);
    expect(buildOnboarding({ ...empty, planPaid: true }).steps.find((x) => x.id === "plan")?.done).toBe(true);
    expect(buildOnboarding({ ...empty, activeIntegrations: 1 }).steps.find((x) => x.id === "portals")?.done).toBe(true);
    expect(buildOnboarding({ ...empty, publishedProperties: 2 }).steps.find((x) => x.id === "portals")?.done).toBe(true);
  });

  it("adım çözümü: geçerli istek kazanır, geçersiz sıradakine düşer", () => {
    const s = buildOnboarding(empty);
    expect(resolveWizardStep("team", s)).toBe("team");
    expect(resolveWizardStep("bitis", s)).toBe("bitis");
    expect(resolveWizardStep("yok", s)).toBe("office");
  });

  it("geri/ileri komşuları", () => {
    expect(wizardNeighbors("team")).toEqual({ prev: "you", next: "pool" });
    expect(wizardNeighbors("office")).toEqual({ prev: null, next: "you" });
    expect(wizardNeighbors("plan")).toEqual({ prev: "giderler-kasa", next: "bitis" });
    expect(wizardNeighbors("bitis")).toEqual({ prev: "plan", next: null });
  });
});

describe("giderler-kasa adımı", () => {
  it("ofis hesabı ya da düzenli ödeme olgusundan tamamlanır", () => {
    const done = (extra: Record<string, boolean>) => buildOnboarding({ ...empty, extra }).steps.find((x) => x.id === "giderler-kasa")?.done;
    expect(done({})).toBe(false);
    expect(done({ "giderler-kasa": true })).toBe(true);
  });
});

describe("ilk işler kontrol listesi (sihirbaz adımı değil)", () => {
  it("beş iş gerçek sayımdan tamamlanır", () => {
    const none = buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 });
    expect(none.map((t) => t.id)).toEqual(["data", "property", "demand", "appointment", "defs"]);
    expect(none.every((t) => !t.done && t.href.startsWith("/app/"))).toBe(true);
    const some = buildFirstTasks({ customers: 3, properties: 0, demands: 1, appointments: 0, customDefinitions: 2 });
    expect(some.filter((t) => t.done).map((t) => t.id)).toEqual(["data", "demand", "defs"]);
  });
});
