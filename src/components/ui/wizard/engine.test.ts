import { describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";
import { draftStorageKey } from "@/lib/form-tabs";
import {
  REVIEW_STEP_ID,
  activeSteps,
  decodeWizardDraft,
  draftDiffers,
  encodeWizardDraft,
  firstInvalidStep,
  issuesByField,
  navigationGuard,
  nextStepId,
  prevStepId,
  resolveStepId,
  runPlan,
  stepStatuses,
  toFormData,
  wizardDraftFormId,
  wizardProgress,
  type PlanTask,
  type WizardStep,
} from "./engine";
import { zodStep } from "./zod-step";

const NOW = 1_760_000_000_000;

const steps: WizardStep[] = [
  { id: "a", label: "A", validate: (v) => (v.name ? [] : [{ field: "wz-name", message: "Ad zorunlu" }]) },
  { id: "b", label: "B", optional: true, validate: (v) => (v.extra === "kötü" ? [{ field: "wz-extra", message: "Geçersiz" }] : []) },
  { id: "c", label: "C", when: (v) => v.showC === "1" },
  { id: "d", label: "D", validate: (v) => (v.amount ? [] : [{ field: "wz-amount", message: "Tutar zorunlu" }]) },
];

describe("adımlar ve gezinme", () => {
  it("koşulu tutmayan adım düşer, sona Özet ve onay eklenir", () => {
    expect(activeSteps(steps, {}).map((s) => s.id)).toEqual(["a", "b", "d", REVIEW_STEP_ID]);
    expect(activeSteps(steps, { showC: "1" }).map((s) => s.id)).toEqual(["a", "b", "c", "d", REVIEW_STEP_ID]);
  });

  it("ileri/geri ve bilinmeyen adım çözümü", () => {
    const list = activeSteps(steps, {});
    expect(nextStepId(list, "a")).toBe("b");
    expect(nextStepId(list, REVIEW_STEP_ID)).toBeNull();
    expect(prevStepId(list, "a")).toBeNull();
    expect(prevStepId(list, "d")).toBe("b");
    expect(resolveStepId(list, "c")).toBe("a"); // koşulu düşmüş adım
    expect(resolveStepId(list, "d")).toBe("d");
  });

  it("gezinme koruması: geri serbest, ileri atlama aradaki geçersiz adımda durur", () => {
    const list = activeSteps(steps, {});
    expect(navigationGuard(list, {}, "d", "a")).toEqual({ ok: true });
    const blocked = navigationGuard(list, {}, "a", REVIEW_STEP_ID);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedAt).toBe("a");
      expect(blocked.issues[0].field).toBe("wz-name");
    }
    const atD = navigationGuard(list, { name: "x" }, "a", REVIEW_STEP_ID);
    expect(atD.ok === false && atD.blockedAt).toBe("d");
    expect(navigationGuard(list, { name: "x", amount: "5" }, "a", REVIEW_STEP_ID)).toEqual({ ok: true });
  });

  it("atlanan isteğe bağlı adımın doğrulaması yok sayılır", () => {
    const list = activeSteps(steps, {});
    const v = { name: "x", amount: "5", extra: "kötü" };
    expect(firstInvalidStep(list, v)?.stepId).toBe("b");
    expect(firstInvalidStep(list, v, new Set(["b"]))).toBeNull();
    expect(navigationGuard(list, v, "a", REVIEW_STEP_ID, new Set(["b"]))).toEqual({ ok: true });
  });

  it("adım durumları: şimdiki, tamam, hatalı, atlandı, sıradaki", () => {
    const list = activeSteps(steps, {});
    const st = stepStatuses(list, { name: "x" }, "d", new Set(["a", "b", "d"]), new Set(["b"]));
    expect(st).toEqual({ a: "complete", b: "skipped", d: "current", [REVIEW_STEP_ID]: "upcoming" });
    expect(stepStatuses(list, {}, "b", new Set(["a", "b"])).a).toBe("error");
  });

  it("ilerleme yüzdesi ilk adımda 0, sonda 100", () => {
    const list = activeSteps(steps, {});
    expect(wizardProgress(list, "a")).toEqual({ index: 1, total: 4, pct: 0 });
    expect(wizardProgress(list, REVIEW_STEP_ID)).toEqual({ index: 4, total: 4, pct: 100 });
  });

  it("alan hatası: alan başına ilk ileti", () => {
    expect(issuesByField([{ field: "x", message: "1" }, { field: "x", message: "2" }, { field: "y", message: "3" }])).toEqual({ x: "1", y: "3" });
  });
});

describe("zod adım doğrulaması", () => {
  const validate = zodStep(
    z.object({ amount: z.string().check(z.minLength(1, "Tutar zorunlu")), rate: z.optional(z.string().check(z.refine((s) => s === "" || Number(s) <= 100, { message: "En çok 100" }))) }),
    { fieldIds: { amount: "wz-amount" } },
  );
  it("sorun yolu alan kimliğine eşlenir; geçerli değer boş liste", () => {
    expect(validate({ amount: "" })).toEqual([{ field: "wz-amount", message: "Tutar zorunlu" }]);
    expect(validate({ amount: "5", rate: "150" })).toEqual([{ field: "rate", message: "En çok 100" }]);
    expect(validate({ amount: "5" })).toEqual([]);
  });
});

describe("taslak", () => {
  const whitelist = ["property_id", "deal_value", "customer_phone", "notes"];
  it("anahtar formlarla aynı ad alanında, kullanıcı başına", () => {
    expect(draftStorageKey("u1", wizardDraftFormId("satis"))).toBe("emlaksoft:draft:v1:u1:sihirbaz-satis");
  });

  it("yalnız beyaz liste + hassas olmayan alanlar yazılır; adım ve atlananlar geri gelir", () => {
    const raw = encodeWizardDraft(
      { values: { property_id: "p1", deal_value: "4.500.000", customer_phone: "05321234567", notes: "gizli", other: "x" }, step: "fiyat", skipped: ["teklif"] },
      whitelist,
      NOW,
    );
    expect(raw).not.toContain("0532");
    expect(raw).not.toContain("gizli");
    expect(raw).not.toContain("other");
    const d = decodeWizardDraft(raw, NOW + 1000, whitelist);
    expect(d).toEqual({ savedAt: NOW, step: "fiyat", skipped: ["teklif"], values: { property_id: "p1", deal_value: "4.500.000" } });
  });

  it("bozuk, süresi dolmuş ya da beyaz liste dışı taslak geri yüklenmez", () => {
    expect(decodeWizardDraft("{bozuk", NOW, whitelist)).toBeNull();
    const raw = encodeWizardDraft({ values: { property_id: "p1" }, step: "a", skipped: [] }, whitelist, NOW);
    expect(decodeWizardDraft(raw, NOW + 8 * 24 * 3600 * 1000, whitelist)).toBeNull();
    expect(decodeWizardDraft(raw, NOW, ["deal_value"])?.values).toEqual({});
  });

  it("başlangıçla aynı taslak için 'Taslağı sürdür' sorulmaz", () => {
    const d = { savedAt: NOW, step: "a", skipped: [], values: { property_id: "p1" } };
    expect(draftDiffers(d, { property_id: "p1" }, "a")).toBe(false);
    expect(draftDiffers({ ...d, step: "b" }, { property_id: "p1" }, "a")).toBe(true);
    expect(draftDiffers({ ...d, values: { property_id: "p2" } }, { property_id: "p1" }, "a")).toBe(true);
  });
});

describe("gönderim planı", () => {
  it("sırayla çalışır, bağlamı taşır", async () => {
    const seen: string[] = [];
    const tasks: PlanTask[] = [
      { id: "kayit", label: "Kayıt", run: async () => ({ ok: true, patch: { id: "r1" } }) },
      { id: "ek", label: "Ek", run: async (ctx) => (seen.push(ctx.id ?? ""), { ok: true, note: "Ek tamam" }) },
    ];
    const res = await runPlan(tasks, { ctx: {}, done: [] });
    expect(res).toEqual({ status: "done", ctx: { id: "r1" }, done: ["kayit", "ek"], notes: ["Ek tamam"] });
    expect(seen).toEqual(["r1"]);
  });

  it("düşen görevde durur; yeniden denemede tamamlananlar TEKRAR ÇALIŞMAZ", async () => {
    const create = vi.fn(async () => ({ ok: true as const, patch: { id: "r1" } }));
    let fail = true;
    const tasks: PlanTask[] = [
      { id: "kayit", label: "Kayıt", run: create },
      { id: "ek", label: "Ek", run: async () => (fail ? { ok: false, error: "Ağ hatası" } : { ok: true }) },
    ];
    const first = await runPlan(tasks, { ctx: {}, done: [] });
    expect(first.status).toBe("failed");
    if (first.status !== "failed") return;
    expect(first.failedId).toBe("ek");
    expect(first.done).toEqual(["kayit"]);
    fail = false;
    const second = await runPlan(tasks, { ctx: first.ctx, done: first.done });
    expect(second.status).toBe("done");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("onay bekleyen işlem 'approval' türüyle durur; fırlatan görev bağlantı hatasına çevrilir", async () => {
    const approval = await runPlan([{ id: "kazan", label: "Kazan", run: async () => ({ ok: false, error: "onay", kind: "approval" }) }], { ctx: {}, done: [] });
    expect(approval.status === "failed" && approval.kind).toBe("approval");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = await runPlan([{ id: "x", label: "X", run: async () => { throw new Error("ağ"); } }], { ctx: {}, done: [] });
    spy.mockRestore();
    expect(thrown.status === "failed" && thrown.error).toMatch(/Yeniden dene/);
  });

  it("FormData yalnız verilen adlarla kurulur", () => {
    const fd = toFormData({ a: "1", b: "2" }, ["a", "c"], { d: "4", e: null });
    expect([...fd.entries()]).toEqual([["a", "1"], ["c", ""], ["d", "4"]]);
  });
});
