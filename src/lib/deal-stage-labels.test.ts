import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINITION_CATEGORIES, SYSTEM_DEFINITION_VALUES, isSystemDefinitionValue } from "@/lib/definition-defaults";
import { defaultStageLabels, resolveStageLabels, stageLabelMap, stageName } from "@/lib/deal-stage-labels";
import { mergeLossReasonDefaults } from "@/lib/loss-reason";
import { DEAL_STAGES } from "@/lib/workflow-state";

describe("aşama etiketi çözümleyici", () => {
  it("varsayılan: beş aşamanın hepsi için varsayılan ad, renk yok", () => {
    const d = defaultStageLabels();
    expect(Object.keys(d).sort()).toEqual([...DEAL_STAGES].sort());
    expect(d.new).toEqual({ label: "Yeni", color: null });
    expect(d.lost.label).toBe("Kaybedildi");
    expect(resolveStageLabels([])).toEqual(d);
    expect(resolveStageLabels(null)).toEqual(d);
  });

  it("özel: ofis adı/rengi varsayılanı geçersiz kılar, eksik aşamalar varsayılan kalır", () => {
    const r = resolveStageLabels([{ value: "negotiation", label: "Pazarlık", color: "#aa00ff" }]);
    expect(r.negotiation).toEqual({ label: "Pazarlık", color: "#aa00ff" });
    expect(r.qualified.label).toBe("Nitelikli");
    expect(stageLabelMap(r).negotiation).toBe("Pazarlık");
    expect(stageName(r, "negotiation")).toBe("Pazarlık");
  });

  it("geçersiz girdi: bilinmeyen anahtar yok sayılır (yeni aşama oluşamaz), boş ad ve bozuk renk düşer", () => {
    const r = resolveStageLabels([
      { value: "sozlesme_imzada", label: "Yeni aşama", color: null },
      { value: "qualified", label: "   ", color: "kirmizi" },
    ]);
    expect(Object.keys(r)).toHaveLength(5);
    expect((r as Record<string, unknown>).sozlesme_imzada).toBeUndefined();
    expect(r.qualified).toEqual({ label: "Nitelikli", color: null });
    expect(stageName(r, "bilinmeyen")).toBe("bilinmeyen");
  });

  it("kilit: won/lost sistem anahtarı, diğerleri değil; kategori kayıtlı", () => {
    expect(SYSTEM_DEFINITION_VALUES.deal_stage_label).toEqual(["won", "lost"]);
    expect(isSystemDefinitionValue("deal_stage_label", "won")).toBe(true);
    expect(isSystemDefinitionValue("deal_stage_label", "lost")).toBe(true);
    expect(isSystemDefinitionValue("deal_stage_label", "negotiation")).toBe(false);
    const keys = DEFINITION_CATEGORIES.map((c) => c.key) as string[];
    expect(keys).toContain("deal_stage_label");
    expect(keys).toContain("loss_reason");
  });

  it("kayıp nedeni birleştirme: 'diger' hep var ve sonda, ofis nedeni araya girer", () => {
    const m = mergeLossReasonDefaults([{ value: "Rakip fiyat kırdı", label: "Rakip fiyat kırdı", color: null }]);
    expect(m[m.length - 1].value).toBe("diger");
    expect(m.map((x) => x.value)).toContain("fiyat_yuksek");
    expect(m.map((x) => x.value)).toContain("Rakip fiyat kırdı");
    expect(m.filter((x) => x.value === "diger")).toHaveLength(1);
  });
});

// Sabit-metin tarama: aşama adı basan yerler tek yardımcıdan okumalı (ham `label: "Müzakere"` gibi sabitler yasak).
const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("aşama adı sabit metin sözleşmesi", () => {
  it("anlaşma aşaması adları yalnız definition-defaults.ts içinde sabit yazılır", () => {
    // Kapsam dışı: platform satış hattı (admin/satis, ayrı kavram: demo talepleri) ve kullanıcıya dönük genel metinler.
    const allowed = [/^lib\/definition-defaults\.ts$/, /^app\/admin\//];
    const patterns = [/qualified:\s*"Nitelikli"/, /negotiation:\s*"Müzakere"/, /\{\s*key:\s*"negotiation",\s*label:/, /value:\s*"negotiation",\s*label:/];
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split(sep).join("/");
      if (allowed.some((a) => a.test(rel))) continue;
      const text = readFileSync(f, "utf8");
      for (const re of patterns) if (re.test(text)) offenders.push(`${rel}: ${re}`);
    }
    expect(offenders).toEqual([]);
  }, 60_000);
});
