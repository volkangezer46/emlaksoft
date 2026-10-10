import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_DIR = join(process.cwd(), "src", "app", "actions");

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

describe("server action yan etkileri yanıtı bekletmez", () => {
  it("otomasyon ve iş akışı tetikleri await edilmez (after() içinde çalışır)", () => {
    const offenders: string[] = [];
    for (const f of actionFiles()) {
      const src = readFileSync(join(ACTIONS_DIR, f), "utf8");
      if (/await\s+dispatchAutomationEvent\b/.test(src)) offenders.push(`${f}: await dispatchAutomationEvent`);
      if (/await\s+triggerPlaybooks\b/.test(src)) offenders.push(`${f}: await triggerPlaybooks`);
    }
    expect(offenders).toEqual([]);
  });

  it("customers/deals/properties: logActivity ve tetikler after() içinde", () => {
    for (const f of ["customers.ts", "deals.ts", "properties.ts"]) {
      const src = readFileSync(join(ACTIONS_DIR, f), "utf8");
      expect(src, f).not.toMatch(/await\s+logActivity\(/);
      expect(src, f).not.toMatch(/await\s+triggerPlaybooks\(/);
      expect(src, f).toMatch(/from "@\/lib\/after-safe"/);
    }
  });

  it("yan etkiler afterSafe ile sarılır: ham after() yok (hata yakalama + günlük tek yerde)", () => {
    const offenders: string[] = [];
    for (const f of actionFiles()) {
      const src = readFileSync(join(ACTIONS_DIR, f), "utf8");
      if (/(^|[^a-zA-Z.])after\(/m.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
    // Davranış (hata yakalama, yanıtı bekletmeme) src/lib/after-safe.test.ts içinde.
  });

  it("toplu aşama değişimi kapıyı bir kez alır, kapısız iç gövdeyi çağırır", () => {
    const src = readFileSync(join(ACTIONS_DIR, "deals.ts"), "utf8");
    const bulk = src.slice(src.indexOf("export async function bulkUpdateDealStage"), src.indexOf("export async function bulkAssignDeals"));
    expect(bulk).not.toMatch(/await updateDealStage\(/);
    expect(bulk).toContain("updateDealStageWithGate(");
    expect(bulk).toContain("BULK_STAGE_CONCURRENCY");
  });

  it("kapak ve anahtar olayı hataları kontrol edilir", () => {
    const media = readFileSync(join(ACTIONS_DIR, "property-media.ts"), "utf8");
    expect(media).toContain("setCoverPropertyMedia clear");
    const keys = readFileSync(join(ACTIONS_DIR, "property-keys.ts"), "utf8");
    expect(keys).not.toMatch(/await supabase\.from\("property_key_events"\)\.insert\(\{/);
    expect(keys).toContain("async function insertKeyEvent");
  });
});
