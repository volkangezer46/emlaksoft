import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFields, projectEditSchema, unitEditSchema } from "./edit-schemas";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("proje düzenleme şeması", () => {
  it("boş opsiyonel alanlar null olur, durum kapalı listeden", () => {
    const r = projectEditSchema.parse({ id: ID, name: " Park Evleri ", developer_name: "", location: "", delivery_date: "", description: "", status: "selling" });
    expect(r).toMatchObject({ name: "Park Evleri", developer_name: null, delivery_date: null, status: "selling" });
  });
  it("ad zorunlu, geçersiz durum ve tarih reddedilir", () => {
    expect(projectEditSchema.safeParse({ id: ID, name: " ", developer_name: "", location: "", delivery_date: "", description: "", status: "selling" }).success).toBe(false);
    expect(projectEditSchema.safeParse({ id: ID, name: "A", developer_name: "", location: "", delivery_date: "", description: "", status: "sold" }).success).toBe(false);
    expect(projectEditSchema.safeParse({ id: ID, name: "A", developer_name: "", location: "", delivery_date: "12.05.2027", description: "", status: "planning" }).success).toBe(false);
  });
});

describe("daire düzenleme şeması", () => {
  const base = { id: ID, block: "A", floor: "3", unit_no: "302", rooms: "2+1", gross_m2: "95.5", list_price: "4500000", notes: "" };
  it("sayılar dönüştürülür, boşlar null", () => {
    expect(unitEditSchema.parse(base)).toMatchObject({ floor: 3, gross_m2: 95.5, list_price: 4500000, notes: null });
    expect(unitEditSchema.parse({ ...base, floor: "", gross_m2: "", list_price: "" })).toMatchObject({ floor: null, gross_m2: null, list_price: null });
  });
  it("daire no zorunlu, negatif fiyat ve bozuk kat reddedilir", () => {
    expect(unitEditSchema.safeParse({ ...base, unit_no: "" }).success).toBe(false);
    expect(unitEditSchema.safeParse({ ...base, list_price: "-1" }).success).toBe(false);
    expect(unitEditSchema.safeParse({ ...base, floor: "3.5" }).success).toBe(false);
    expect(unitEditSchema.safeParse({ ...base, gross_m2: "abc" }).success).toBe(false);
  });
  it("durum alanı şemada yok (durum kendi akışında)", () => {
    expect(Object.keys(unitEditSchema.shape)).not.toContain("status");
  });
});

describe("değişen alan farkı", () => {
  it("numeric metin/sayı eşitliği değişiklik sayılmaz", () => {
    expect(changedFields({ list_price: "4500000.00", rooms: "2+1" } as Record<string, unknown>, { list_price: 4500000, rooms: "2+1" })).toEqual({});
    expect(changedFields({ list_price: 1, rooms: null } as Record<string, unknown>, { list_price: 2, rooms: "3+1" })).toEqual({ list_price: 2, rooms: "3+1" });
  });
});

describe("sözleşme: proje/daire düzenleme action'ları", () => {
  const src = read("src/app/actions/projects.ts");
  for (const fn of ["updateProject", "updateUnit"]) {
    it(`${fn} yetki + şema + tenant süzgeci + denetim kaydı`, () => {
      const body = src.slice(src.indexOf(`export async function ${fn}`), src.indexOf("\n}\n", src.indexOf(`export async function ${fn}`)));
      expect(body).toContain('requirePermission("projects", "edit")');
      expect(body).toMatch(/Schema\.safeParse/);
      expect(body).toContain('.eq("tenant_id", gate.tenantId)');
      expect(body).toContain("logActivity(");
    });
  }
  it("daire/proje panelleri popup değil", () => {
    for (const f of ["src/app/app/projeler/[id]/units-board.tsx", "src/app/app/projeler/[id]/add-units-panel.tsx", "src/app/app/projeler/[id]/project-edit-panel.tsx"]) {
      expect(read(f), f).not.toContain("@/components/ui/dialog");
    }
  });
});
