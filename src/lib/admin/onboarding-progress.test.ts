import { describe, expect, it } from "vitest";
import { EMPTY_ONBOARDING_CONTENT, parseOnboardingContent } from "@/lib/onboarding-content";
import { ONBOARDING_STEP_IDS, getOnboardingStepDef } from "@/lib/onboarding-steps";
import { PROGRESS_DONE_FILTER, buildOfficeProgress, filterProgress, stuckSummary, type OnboardingFactsRow } from "./onboarding-progress";

const base = (id: string, extra: Partial<OnboardingFactsRow> = {}): OnboardingFactsRow => ({
  tenant_id: id,
  tenant_name: `Ofis ${id}`,
  status: "trial",
  plan: "office",
  created_at: "2026-10-01T00:00:00Z",
  province_id: null,
  district_id: null,
  address_line: null,
  license_no: null,
  owner_you_done: false,
  members: 1,
  pool_enabled: false,
  pool_advisor_records: 0,
  published_properties: 0,
  active_integrations: 0,
  sub_status: "trialing",
  office_finance: 0,
  office_recurring: 0,
  rentals_answered: false,
  portal_declared: 0,
  eids_received: false,
  ...extra,
});

const officeDone = { province_id: "il", district_id: "ilce", address_line: "Cumhuriyet Mah. 12. Sokak No: 4" };
const allDone: Partial<OnboardingFactsRow> = {
  ...officeDone,
  license_no: "7700123",
  owner_you_done: true,
  members: 4,
  pool_enabled: true,
  pool_advisor_records: 3,
  sub_status: "active",
  office_finance: 1,
  rentals_answered: true,
  published_properties: 1,
  portal_declared: 2,
  eids_received: true,
};

describe("ofis bazında kurulum ilerlemesi (SN5)", () => {
  it("olgulardan sihirbazla aynı kurallarla ilerleme ve takılan adım çıkar", () => {
    const empty = buildOfficeProgress(base("a"), EMPTY_ONBOARDING_CONTENT);
    // C27: yalnız 4 zorunlu adım sayılır (isteğe bağlı ayarlar ve ofis düzeyinde "Siz" adımı katılmaz).
    expect(empty.total).toBe(ONBOARDING_STEP_IDS.filter((id) => !getOnboardingStepDef(id)?.optional && !getOnboardingStepDef(id)?.optionalFor).length);
    expect(empty.total).toBe(4);
    expect(empty.doneCount).toBe(0);
    expect(empty.stuckId).toBe("office");

    const office = buildOfficeProgress(base("b", officeDone), EMPTY_ONBOARDING_CONTENT);
    expect(office.steps.find((s) => s.id === "office")!.done).toBe(true);
    expect(office.stuckId).toBe("ofis-tipi");

    const done = buildOfficeProgress(base("c", allDone), EMPTY_ONBOARDING_CONTENT);
    expect(done.percent).toBe(100);
    expect(done.stuckId).toBeNull();
  });

  it("ofis bazında ilerleme listelenir ve takılan adıma göre süzülür", () => {
    const rows = [
      buildOfficeProgress(base("a"), EMPTY_ONBOARDING_CONTENT),
      buildOfficeProgress(base("b", officeDone), EMPTY_ONBOARDING_CONTENT),
      buildOfficeProgress(base("c", { ...officeDone, rentals_answered: true }), EMPTY_ONBOARDING_CONTENT),
      buildOfficeProgress(base("d", allDone), EMPTY_ONBOARDING_CONTENT),
    ];
    expect(filterProgress(rows, null).map((r) => r.tenantId)).toEqual(["a", "b", "c", "d"]);
    expect(filterProgress(rows, "office").map((r) => r.tenantId)).toEqual(["a"]);
    expect(filterProgress(rows, "ofis-tipi").map((r) => r.tenantId)).toEqual(["b"]);
    expect(filterProgress(rows, "veri").map((r) => r.tenantId)).toEqual(["c"]);
    expect(filterProgress(rows, PROGRESS_DONE_FILTER).map((r) => r.tenantId)).toEqual(["d"]);
    expect(filterProgress(rows, "olmayan-adim")).toEqual([]);

    const summary = stuckSummary(rows);
    expect(summary.done).toBe(1);
    expect(summary.steps).toEqual([
      { id: "office", label: "Ofis", count: 1 },
      { id: "ofis-tipi", label: "İş türü", count: 1 },
      { id: "veri", label: "Veriler", count: 1 },
    ]);
  });

  it("adminden kapatılan adım ofis ilerlemesine sayılmaz; paket hedefi ofisin paketiyle", () => {
    const content = parseOnboardingContent(
      JSON.stringify({
        v: 1,
        tours: {},
        checklist: ONBOARDING_STEP_IDS.map((id) => ({
          id,
          short: id,
          title: id,
          description: "Açıklama",
          enabled: id !== "office",
          roles: id === "you" ? ["advisor"] : [],
          plans: id === "plan" ? ["professional"] : [],
        })),
      }),
    );
    const p = buildOfficeProgress(base("a", { plan: "office" }), content);
    const ids = p.steps.map((s) => s.id);
    expect(ids).not.toContain("office");
    expect(ids).not.toContain("plan");
    expect(ids).toContain("you"); // rol hedefi ofis düzeyinde uygulanmaz
    expect(p.stuckId).toBe("ofis-tipi");
  });
});
