import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { customFilterRaw, parseCustomFilterParam } from "./filter";
import type { CustomFieldDef } from "./core";

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: "d1", entity: "customer", key: "isitma", label: "Isıtma", fieldType: "select", options: ["Kombi", "Merkezi"], required: false, position: 1, active: true, ...over,
});

describe("özel alanlar: liste filtresi, yeni kayıt formları, tam dışa aktarma", () => {
  it("URL kontratı ?ozel=anahtar:değer (form alan/değer çifti aynı kontrata iner); tür doğrulaması", () => {
    expect(customFilterRaw({ ozel: "isitma:Kombi" })).toBe("isitma:Kombi");
    expect(customFilterRaw({ ozel_alan: "isitma", ozel_deger: " Kombi " })).toBe("isitma:Kombi");
    expect(parseCustomFilterParam("isitma:Kombi", [def({})])).toMatchObject({ value: "Kombi" });
    expect(parseCustomFilterParam("isitma:Soba", [def({})])).toBeNull();
    expect(parseCustomFilterParam("bilinmeyen:x", [def({})])).toBeNull();
    expect(parseCustomFilterParam("krediye:belki", [def({ key: "krediye", fieldType: "boolean", options: [] })])).toBeNull();
  });

  it("dört liste sayfası filtreyi sunucu sorgusuna uygular ve çubuğu çizer", () => {
    for (const f of ["src/app/app/musteriler/data.ts", "src/app/app/portfoyler/page.tsx", "src/app/app/anlasmalar/page.tsx", "src/app/app/talepler/demands-view.tsx"]) {
      expect(src(f), f).toContain("applyCustomFieldIds(");
    }
    for (const f of ["src/app/app/musteriler/page.tsx", "src/app/app/portfoyler/page.tsx", "src/app/app/anlasmalar/page.tsx", "src/app/app/talepler/demands-view.tsx"]) {
      expect(src(f), f).toContain("<CustomFieldFilterBar");
    }
  });

  it("oluşturma action'ları özel alanı kayıttan ÖNCE doğrular, SONRA yazar; formlar girişleri çizer", () => {
    for (const f of ["src/app/actions/deals.ts", "src/app/actions/properties.ts", "src/app/actions/demands.ts", "src/app/actions/customer-with-demand.ts"]) {
      const s = src(f);
      const prep = s.indexOf("prepareCustomFieldInputs(");
      const write = s.indexOf("writeCustomFieldInputs(", prep);
      expect(prep, f).toBeGreaterThan(-1);
      expect(write, f).toBeGreaterThan(prep);
    }
    for (const f of ["src/app/app/musteriler/yeni/customer-form.tsx", "src/app/app/portfoyler/yeni/property-form.tsx", "src/app/app/talepler/yeni/demand-form.tsx", "src/app/app/anlasmalar/yeni/new-deal-form.tsx"]) {
      expect(src(f), f).toContain("<CustomFieldInputs defs={customFields} />");
    }
  });

  it("tam akışlı dışa aktarma ozel: sütunlarını ekler (dört varlık, sorguda id)", () => {
    const s = src("src/lib/export-full.ts");
    expect(s).toContain("CUSTOM_FIELD_EXPORT_ENTITY");
    expect(s).toContain("...customFor(r)");
    for (const slug of ["musteriler", "portfoyler", "talepler", "anlasmalar"]) expect(s).toMatch(new RegExp(`${slug}: "(customer|property|demand|deal)"`));
  });
});
