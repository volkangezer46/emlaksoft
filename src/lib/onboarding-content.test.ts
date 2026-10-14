import { describe, expect, it } from "vitest";
import {
  compactOnboardingContent,
  isEmptyOnboardingContent,
  materializeOnboardingContent,
  parseOnboardingContent,
  resolveChecklistDefs,
  resolveTours,
  validateOnboardingContentFull,
  EMPTY_ONBOARDING_CONTENT,
} from "./onboarding-content";
import { buildOnboarding, wizardNeighbors, resolveWizardStep, type OnboardingFacts } from "./onboarding-checklist";
import { ONBOARDING_STEP_IDS } from "./onboarding-steps";
import { TOURS, resolveTourSteps } from "./product-tour-data";
import type { AppModule } from "./permissions";
import { getSettingDef } from "./settings/registry";

const ALL: AppModule[] = ["dashboard", "customers", "demands", "properties", "appointments", "commissions", "tasks", "team", "settings", "billing", "reports", "targets"];

const FACTS: OnboardingFacts = {
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

/** Düzenleyicinin göndereceği tam içerik: varsayılandan başlar, verilen değişiklik uygulanır. */
function edited(mutate: (full: ReturnType<typeof materializeOnboardingContent>) => void) {
  const full = materializeOnboardingContent(EMPTY_ONBOARDING_CONTENT);
  mutate(full);
  const valid = validateOnboardingContentFull(full);
  if (!valid.ok) throw new Error(valid.error);
  // Depoya yazılan biçim (JSON) ve geri okunan içerik: ofis tarafı bunu okur.
  return parseOnboardingContent(JSON.stringify(compactOnboardingContent(valid.value)));
}

describe("tur ve kurulum içeriği (SN5)", () => {
  it("ayar boş/bozuksa koddaki turlar ve adımlar aynen kullanılır", () => {
    for (const raw of [null, "", "{bozuk", JSON.stringify({ v: 2 }), JSON.stringify({ tours: { danisman: { label: "" } } })]) {
      const c = parseOnboardingContent(raw);
      expect(isEmptyOnboardingContent(c)).toBe(true);
      expect(resolveTours(c, { role: "owner", plan: "office" })).toEqual(TOURS);
      expect(resolveChecklistDefs(c, { role: "owner" }).map((d) => d.id)).toEqual([...ONBOARDING_STEP_IDS]);
    }
  });

  it("varsayılanla aynı içerik kaydedilmez (boş = varsayılana dön)", () => {
    const full = materializeOnboardingContent(EMPTY_ONBOARDING_CONTENT);
    const valid = validateOnboardingContentFull(JSON.parse(JSON.stringify(full)));
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(isEmptyOnboardingContent(compactOnboardingContent(valid.value))).toBe(true);
  });

  it("admin bir tur adımının metnini değiştirince ofiste yeni metin görünür", () => {
    const content = edited((f) => {
      f.tours.danisman.steps[1]!.title = "Müşteri defteri";
      f.tours.danisman.steps[1]!.desc = "Yeni açıklama metni.";
    });
    expect(Object.keys(content.tours)).toEqual(["danisman"]); // yalnız değişen tur yazılır
    const tours = resolveTours(content, { role: "advisor", plan: "office" });
    const danisman = tours.find((t) => t.id === "danisman")!;
    expect(danisman.steps[1]).toMatchObject({ path: "/app/musteriler", title: "Müşteri defteri", desc: "Yeni açıklama metni." });
    // Diğer turlar koddan gelir.
    expect(tours.find((t) => t.id === "yonetici")).toEqual(TOURS.find((t) => t.id === "yonetici"));
    // Çalıştırıcının menü elemesi düzenlenmiş turla çalışır.
    const steps = resolveTourSteps("danisman", { accessible: ALL, closed: [] }, tours);
    expect(steps.map((s) => s.title)).toContain("Müşteri defteri");
  });

  it("tur adımı: sıra, açık/kapalı, rol ve paket hedefi", () => {
    const content = edited((f) => {
      const s = f.tours.yonetici.steps;
      [s[0], s[1]] = [s[1]!, s[0]!];
      s[2]!.enabled = false;
      s[3]!.roles = ["gm"];
      s[4]!.plans = ["professional"];
    });
    const titlesFor = (role: string, plan: string) => resolveTours(content, { role, plan }).find((t) => t.id === "yonetici")!.steps.map((s) => s.title);
    expect(titlesFor("gm", "professional")).toEqual(["Ekip", "Bugün", "Hedefler", "Anlaşmalar", "Raporlar"]);
    expect(titlesFor("team_lead", "office")).toEqual(["Ekip", "Bugün", "Raporlar"]);
  });

  it("kurulum adımı: metin, sıra, kapatma ve hedefleme sihirbaza yansır", () => {
    const content = edited((f) => {
      const team = f.checklist.findIndex((s) => s.id === "team");
      const [t] = f.checklist.splice(team, 1);
      f.checklist.unshift({ ...t!, title: "Ekibini çağır", short: "Ekip" });
      f.checklist.find((s) => s.id === "eids-eposta")!.enabled = false;
      f.checklist.find((s) => s.id === "plan")!.roles = ["owner"];
      f.checklist.find((s) => s.id === "giderler-kasa")!.plans = ["professional"];
    });
    const ownerDefs = resolveChecklistDefs(content, { role: "owner", plan: "office" });
    const ids = ownerDefs.map((d) => d.id);
    expect(ids[0]).toBe("team");
    expect(ids).not.toContain("eids-eposta");
    expect(ids).not.toContain("giderler-kasa");
    expect(ids).toContain("plan");
    expect(resolveChecklistDefs(content, { role: "gm", plan: "professional" }).map((d) => d.id)).toEqual(
      expect.arrayContaining(["giderler-kasa"]),
    );
    expect(resolveChecklistDefs(content, { role: "gm" }).map((d) => d.id)).not.toContain("plan");

    const state = buildOnboarding({ ...FACTS, members: 3 }, [], ownerDefs);
    expect(state.steps[0]).toMatchObject({ id: "team", title: "Ekibini çağır", done: true });
    expect(state.total).toBe(ownerDefs.length);
    expect(state.nextId).toBe("office");
    // Sihirbaz komşuları ve istenen adım düzenlenmiş listeye göre.
    const order = state.steps.map((s) => s.id);
    expect(wizardNeighbors("team", order)).toEqual({ prev: null, next: "office" });
    expect(resolveWizardStep("eids-eposta", state)).toBe("office");
  });

  it("kayıtlı listede olmayan yeni kod adımı sona eklenir, bilinmeyen kimlik atılır", () => {
    const content = parseOnboardingContent(
      JSON.stringify({
        v: 1,
        tours: {},
        checklist: [
          { id: "plan", short: "Paket", title: "Paket", description: "Açıklama", enabled: true, roles: [], plans: [] },
          { id: "silinmis-adim", short: "X", title: "X", description: "X", enabled: true, roles: [], plans: [] },
        ],
      }),
    );
    const ids = resolveChecklistDefs(content, {}).map((d) => d.id);
    expect(ids[0]).toBe("plan");
    expect(ids).not.toContain("silinmis-adim");
    expect([...ids].sort()).toEqual([...ONBOARDING_STEP_IDS].sort());
  });

  it("doğrulama Türkçe ve yeri belirtilmiş hata verir", () => {
    const full = materializeOnboardingContent(EMPTY_ONBOARDING_CONTENT);
    full.tours["ofis-sahibi"].steps[2]!.path = "https://kotu.example";
    const res = validateOnboardingContentFull(full);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/^Ofis sahibi turu · 3\. adım: Sayfa \/app/);

    const dup = materializeOnboardingContent(EMPTY_ONBOARDING_CONTENT);
    dup.checklist.push({ ...dup.checklist[0]! });
    const r2 = validateOnboardingContentFull(dup);
    expect(r2.ok).toBe(false);
  });

  it("ayar defterinde köprü ayar olarak kayıtlı (merkezden doğrudan yazılamaz)", () => {
    const def = getSettingDef("onboarding.content");
    expect(def?.editMode).toBe("bridge");
    expect(def?.home?.href).toBe("/admin/tenants/kurulum?sekme=icerik");
    expect(def?.scope).toBe("platform");
  });
});
