import { describe, expect, it } from "vitest";
import {
  buildFirstTasks,
  buildOnboarding,
  resolveWizardStep,
  scopeOnboardingToPermissions,
  splitOptional,
  visibleFirstTasks,
  wizardNeighbors,
  wizardPosition,
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
  it("adım sırası (C27): 4 zorunlu adım (ofis, ne iş yapıyorsunuz, verileri taşı, ekip), kişisel adım, isteğe bağlı ayarlar", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["office", "ofis-tipi", "veri", "team", "you", "yetki-belgesi", "pool", "portals", "giderler-kasa", "eids-eposta", "plan"]);
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
    // C27: ofis düzeyinde 4 zorunlu adım; "Siz" (optionalFor) ve isteğe bağlı ayarlar sayaca katılmaz.
    expect(s.total).toBe(4);
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
    const s = buildOnboarding({ ...empty, officeLocationDone: true, youDone: true, poolEnabled: true, poolAdvisorRecords: 1, extra: { veri: true } });
    // Ofis + veri tamam (Siz ve havuz isteğe bağlı: sayılmaz).
    expect(s.doneCount).toBe(2);
    expect(s.percent).toBe(50);
    expect(s.nextId).toBe("ofis-tipi");
  });

  it("isteğe bağlı adımlar yüzdeye, sayaca ve 'tamam' kararına katılmaz", () => {
    const optional = buildOnboarding(empty).steps.filter((s) => s.optional).map((s) => s.id);
    expect(optional).toEqual(["you", "yetki-belgesi", "pool", "portals", "giderler-kasa", "eids-eposta", "plan"]);
    const s = buildOnboarding({
      ...empty,
      officeLocationDone: true,
      members: 2,
      extra: { "ofis-tipi": true, veri: true },
    });
    // Yalnız 4 zorunlu adım tamam; isteğe bağlı ayarların hiçbiri yapılmadı → kurulum tamam (%100).
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
    expect(s.settled).toBe(true);
    expect(s.nextId).toBeNull();
    const parts = splitOptional(s.steps);
    expect(parts.required.length).toBe(4);
    expect(parts.optional.map((x) => x.id)).toEqual(optional);
  });

  it("atlanan adım sonraki adım seçilmez ama tamamlanmış sayılmaz", () => {
    const s = buildOnboarding(empty, ["office"]);
    expect(s.nextId).toBe("ofis-tipi");
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
    const s = buildOnboarding({ ...full, extra: { "giderler-kasa": true, "ofis-tipi": true, veri: true, "yetki-belgesi": true, "eids-eposta": true } });
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
    expect(wizardNeighbors("team")).toEqual({ prev: "veri", next: "you" });
    expect(wizardNeighbors("office")).toEqual({ prev: null, next: "ofis-tipi" });
    expect(wizardNeighbors("plan")).toEqual({ prev: "eids-eposta", next: "bitis" });
    // Sihirbaz yalnız zorunlu adımlar arasında gezer (isteğe bağlılar özetten açılır).
    expect(wizardNeighbors("team", ["office", "ofis-tipi", "veri", "team"])).toEqual({ prev: "veri", next: "bitis" });
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
  it("işler gerçek sayımdan tamamlanır ve her biri götürdüğü sayfanın oluşturma iznini taşır", () => {
    const none = buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 });
    expect(none.map((t) => t.id)).toEqual(["data", "property", "demand", "appointment", "defs", "expense", "commission", "vitrin"]);
    expect(none.every((t) => !t.done && t.href.startsWith("/app/") && t.requires)).toBe(true);
    const some = buildFirstTasks({ customers: 3, properties: 0, demands: 1, appointments: 0, customDefinitions: 2, officeCash: true });
    expect(some.filter((t) => t.done).map((t) => t.id)).toEqual(["data", "demand", "defs", "expense"]);
  });

  it("muhasebe yalnız kendi ilk işlerini, danışman yalnız satış işlerini görür", () => {
    const tasks = buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 });
    expect(visibleFirstTasks(tasks, { ...DEFAULT_MATRIX.accounting }).map((t) => t.id)).toEqual(["expense", "commission"]);
    expect(visibleFirstTasks(tasks, { ...DEFAULT_MATRIX.advisor }).map((t) => t.id)).toEqual(["data", "property", "demand", "appointment"]);
    expect(visibleFirstTasks(tasks, { ...DEFAULT_MATRIX.readonly })).toEqual([]);
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

  it("C27: ofis sahibinde zorunlu akış 4 adım, 'Adım x / 4'; 'Siz' sahipte isteğe bağlı, danışmanda zorunlu", () => {
    const s = scopeOnboardingToPermissions(buildOnboarding(empty), owner);
    expect(splitOptional(s.steps).required.map((x) => x.id)).toEqual(["office", "ofis-tipi", "veri", "team"]);
    expect(s.total).toBe(4);
    expect(s.steps.find((x) => x.id === "you")?.optional).toBe(true);
    expect(wizardPosition("office", s)).toEqual({ index: 1, total: 4 });
    expect(wizardPosition("veri", s)).toEqual({ index: 3, total: 4 });
    expect(wizardPosition("pool", s)).toBeNull();
    expect(wizardPosition("bitis", s)).toBeNull();
    const a = scopeOnboardingToPermissions(buildOnboarding(empty), advisor);
    expect(a.steps.find((x) => x.id === "you")?.optional).toBe(false);
    expect(wizardPosition("you", a)).toEqual({ index: 1, total: 1 });
  });

  it("C27: 'Ne iş yapıyorsunuz' kira sorusu cevabından, 'Verileri taşı' gerçek müşteri/portföyden tamamlanır", () => {
    const done = (id: string, extra: Record<string, boolean>) => buildOnboarding({ ...empty, extra }).steps.find((x) => x.id === id)?.done;
    expect(done("ofis-tipi", {})).toBe(false);
    expect(done("ofis-tipi", { "ofis-tipi": true })).toBe(true);
    expect(done("veri", {})).toBe(false);
    expect(done("veri", { veri: true })).toBe(true);
  });

  it("'Tanımlarını gözden geçir' düzenleme yetkisi olmayana gösterilmez", () => {
    const tasks = buildFirstTasks({ customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 });
    expect(visibleFirstTasks(tasks, advisor).map((t) => t.id)).not.toContain("defs");
    expect(visibleFirstTasks(tasks, owner).map((t) => t.id)).toContain("defs");
  });
});

describe("ilk işler: vitrin arama onayı", () => {
  it("onay yokken açık, onay verilince tamam; ayarlar/vitrin'e götürür ve ayar düzenleme izni ister", () => {
    const base = { customers: 0, properties: 0, demands: 0, appointments: 0, customDefinitions: 0 };
    const open = buildFirstTasks(base).find((t) => t.id === "vitrin")!;
    expect(open.done).toBe(false);
    expect(open.href).toBe("/app/ayarlar/vitrin");
    expect(open.title).toBe("Vitrininizi Google'da görünür yapın");
    expect(open.requires).toEqual({ module: "settings", action: "edit" });
    expect(buildFirstTasks({ ...base, vitrinSeoOptin: true }).find((t) => t.id === "vitrin")!.done).toBe(true);
  });
});
