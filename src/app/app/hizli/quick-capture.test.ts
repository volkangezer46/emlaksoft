import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ACTIONS } from "@/lib/palette-core";
import { QUICK_INTENTS, QUICK_INTENT_TYPES, buildQuickPropertyTitle } from "./quick-intents";

/**
 * Hızlı kayıt sözleşmesi: sekmeli tek sayfa (popup yok), mevcut server action'lar sarılır,
 * iletişim alanları ortak bileşenlerle, saat kuralı clock.ts üzerinden.
 */
const dir = import.meta.dirname;
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

describe("hızlı kayıt", () => {
  const ui = read("quick-capture.tsx");
  const actions = read("actions.ts");
  const page = read("page.tsx");

  it("yeni mantık kopyalanmaz: mevcut action'lar çağrılır", () => {
    for (const fn of ["createCustomer(", "createCall(", "createAppointment("]) expect(actions).toContain(fn);
    expect(actions).not.toMatch(/\.from\("(customers|calls|appointments)"\)\s*\.insert/);
  });

  it("popup/diyalog yok; üç sekme ve çakışma freni", () => {
    expect(ui).not.toMatch(/Dialog|Sheet|Drawer|Modal/);
    for (const id of ['"musteri"', '"gorusme"', '"randevu"']) expect(ui).toContain(id);
    expect(ui).toContain("confirm_conflict");
    expect(ui).toContain("<MorphTabs");
  });

  it("telefon PhoneInput, ham tel/email input yok, görüşmede süre alanı yok", () => {
    expect(ui).toContain("<PhoneInput");
    expect(ui).not.toMatch(/type="(tel|email)"/);
    expect(ui).not.toContain("duration_sec");
  });

  it("zaman kuralı: Date.now / new Date yok, TR saati clock.ts ile ayrıştırılır", () => {
    for (const src of [ui, actions, page]) expect(src).not.toMatch(/Date\.now\(|new Date\(/);
    expect(actions).toContain("parseTrLocalDateTime");
  });

  it("sekmeler yetkiyle belirlenir, hiçbiri yoksa erişim yok", () => {
    expect(page).toContain("requireModulePage");
    expect(page).toMatch(/tabs\.length === 0\) redirect/);
  });

  it("ne arıyor seçenekleri müşteri türüne eşlenir", () => {
    for (const i of QUICK_INTENTS) expect(QUICK_INTENT_TYPES[i.id]).toBeTruthy();
  });

  it("komut paleti / Yeni menüsü tek kaynağında kayıtlı", () => {
    expect(APP_ACTIONS.some((a) => a.href === "/app/hizli" && a.label === "Hızlı kayıt")).toBe(true);
  });

  it("hızlı portföy: createProperty sarılır (taslak), başlık otomatik, komisyon ofis varsayılanı, fotoğraf mevcut yükleyiciyle", () => {
    expect(actions).toContain("createProperty(out)");
    expect(actions).toContain('"office.commission.default_rate"');
    expect(actions).not.toMatch(/\.from\("properties"\)\s*\.insert/);
    expect(ui).toContain('"portfoy"');
    expect(ui).toContain("<PropertyMediaManager");
    expect(ui).toContain("navigator.geolocation");
    expect(page).toMatch(/can\("properties"\) && \(perms\.properties \?\? \[\]\)\.includes\("edit"\)/);
  });

  it("otomatik başlık: oda + işlem + tür + m²; boşsa taslak adı", () => {
    expect(buildQuickPropertyTitle({ rooms: "3+1", transactionType: "Satılık", propertyType: "Daire", sqm: 120 })).toBe("3+1 Satılık Daire, 120 m²");
    expect(buildQuickPropertyTitle({})).toBe("Yeni portföy (taslak)");
  });
});
