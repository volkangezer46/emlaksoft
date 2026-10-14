import { describe, expect, it } from "vitest";
import {
  buildFirstTasks,
  buildOnboarding,
  resolveWizardStep,
  scopeOnboardingToPermissions,
  visibleFirstTasks,
  wizardNeighbors,
  type OnboardingFacts,
} from "./onboarding-checklist";
import { ONBOARDING_STEP_DEFS, ONBOARDING_STEP_IDS, isWizardStepKey } from "./onboarding-steps";
import { DEFAULT_MATRIX } from "./permissions";
import type { EffectivePermissions } from "./permissions-effective";
import { computeProfileCompletion, isOfficeLocationDone, type ProfileFacts } from "./profile-completion";

const empty: OnboardingFacts = {
  officeLocationDone: false,
  youDone: false,
  members: 1,
  poolEnabled: false,
  poolAdvisorRecords: 0,
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
  poolAdvisorRecords: 2,
  publishedProperties: 1,
  activeIntegrations: 0,
  planPaid: true,
  extra: {},
};

describe("onboarding-steps kaydı", () => {
  it("adım sırası: ofis, sen, ekip, havuz, portallar, giderler ve kasa, paket", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["office", "yetki-belgesi", "you", "team", "pool", "portals", "eids-eposta", "giderler-kasa", "mulk-yonetimi", "plan"]);
    expect(new Set(ONBOARDING_STEP_IDS).size).toBe(ONBOARDING_STEP_DEFS.length);
  });

  it("yalnız gerçek adım kimlikleri geçerlidir; eski takma adlar (data, yetki, eids) tanınmaz", () => {
    expect(isWizardStepKey("portals")).toBe(true);
    expect(isWizardStepKey("bitis")).toBe(true);
    for (const old of ["konum", "data", "property", "defs", "yetki", "eids", "yok", undefined]) expect(isWizardStepKey(old), String(old)).toBe(false);
  });
});

describe("onboarding-checklist", () => {
  it("boş ofis: %0, ilk adım ofis bilgileri", () => {
    const s = buildOnboarding(empty);
    expect(s.percent).toBe(0);
    expect(s.nextId).toBe("office");
    expect(s.total).toBe(10);
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
    const s = buildOnboarding({ ...empty, officeLocationDone: true, youDone: true, poolEnabled: true, poolAdvisorRecords: 1 });
    expect(s.doneCount).toBe(3);
    expect(s.percent).toBe(30);
    expect(s.nextId).toBe("yetki-belgesi");
  });

  it("atlanan adım sonraki adım seçilmez ama tamamlanmış sayılmaz", () => {
    const s = buildOnboarding(empty, ["office"]);
    expect(s.nextId).toBe("yetki-belgesi");
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
    const s = buildOnboarding({ ...full, extra: { "giderler-kasa": true, "mulk-yonetimi": true, "yetki-belgesi": true, "eids-eposta": true } });
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(resolveWizardStep(undefined, s)).toBe("bitis");
  });

  it("havuz ve paket adımları gerçek olgudan tamamlanır; portallar yayın ya da entegrasyondan", () => {
    const pool = (f: Partial<OnboardingFacts>) => buildOnboarding({ ...empty, ...f }).steps.find((x) => x.id === "pool")?.done;
    expect(pool({ poolEnabled: true, poolAdvisorRecords: 1 })).toBe(true);
    // Havuz açık ama gerçek uzmanlık/bölge kaydı yok (örnek veri sayılmaz): atama çalışamaz, adım bitmez.
    expect(pool({ poolEnabled: true, poolAdvisorRecords: 0 })).toBe(false);
    expect(pool({ poolEnabled: false, poolAdvisorRecords: 3 })).toBe(false);
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
    expect(wizardNeighbors("office")).toEqual({ prev: null, next: "yetki-belgesi" });
    expect(wizardNeighbors("plan")).toEqual({ prev: "mulk-yonetimi", next: "bitis" });
    expect(wizardNeighbors("bitis")).toEqual({ prev: "plan", next: null });
  });
});

describe("EİDS kurulum adımları (EP5)", () => {
  it("yetki belgesi no ve Bakanlık e-postaları gerçek olgudan tamamlanır", () => {
    const done = (id: string, extra: Record<string, boolean>) => buildOnboarding({ ...empty, extra }).steps.find((x) => x.id === id)?.done;
    expect(done("yetki-belgesi", {})).toBe(false);
    expect(done("yetki-belgesi", { "yetki-belgesi": true })).toBe(true);
    expect(done("eids-eposta", {})).toBe(false);
    expect(done("eids-eposta", { "eids-eposta": true })).toBe(true);
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

describe("yetkiye göre Başlangıç kartı kapsamı", () => {
  const advisor: EffectivePermissions = { ...DEFAULT_MATRIX.advisor };
  const owner: EffectivePermissions = { ...DEFAULT_MATRIX.owner };

  it("danışmanda yalnız kişisel adım kalır; yüzde ondan hesaplanır", () => {
    const s = scopeOnboardingToPermissions(buildOnboarding(empty), advisor);
    expect(s.steps.map((x) => x.id)).toEqual(["you"]);
    expect(s.total).toBe(1);
    expect(s.percent).toBe(0);
    expect(s.nextId).toBe("you");
    const titles = s.steps.map((x) => x.title);
    expect(titles).not.toContain("Ofis bilgilerin");
    expect(titles).not.toContain("Giderler ve kasa");
  });

  it("danışmanın kişisel adımı tamamsa kart için settled (gizlenir)", () => {
    const s = scopeOnboardingToPermissions(buildOnboarding({ ...empty, youDone: true }), advisor);
    expect(s.settled).toBe(true);
    expect(s.percent).toBe(100);
  });

  it("ofis sahibi tüm adımları görür", () => {
    const s = scopeOnboardingToPermissions(buildOnboarding(empty), owner);
    expect(s.steps.map((x) => x.id)).toEqual([...ONBOARDING_STEP_IDS]);
    expect(s.nextId).toBe("office");
  });

  it("'Tanımlarını gözden geçir' düzenleme yetkisi olmayana gösterilmez", () => {
    const tasks = buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 });
    expect(visibleFirstTasks(tasks, advisor).map((t) => t.id)).not.toContain("defs");
    expect(visibleFirstTasks(tasks, owner).map((t) => t.id)).toContain("defs");
  });
});
