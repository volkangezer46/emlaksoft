import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOS_CHECKLIST_ITEMS,
  GOS_CLAUSE_MARKER,
  GOS_CLAUSE_TEXT,
  GOS_DATE_NOTE,
  GOS_NO_MONEY_NOTE,
  GOS_SOURCES,
  GOS_SUMMARY,
  appendGosClause,
  gosClauseApplies,
} from "./gos-info";
import { RENT_CHECKLIST, SALE_CHECKLIST, templateForDealType } from "./deal-checklist-templates";
import { FOREIGN_SALE_CHECKLIST, FOREIGN_SALE_GUIDE, guideCardVerification } from "./foreign-sale-checklist";
import { legalValue } from "./legal-constants";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("GÖS tek kaynak", () => {
  it("satış ve yabancıya satış listeleri aynı GÖS maddelerini taşır; kiralama taşımaz", () => {
    for (const item of GOS_CHECKLIST_ITEMS) {
      expect(SALE_CHECKLIST).toContainEqual(item);
      expect(FOREIGN_SALE_CHECKLIST).toContainEqual(item);
      expect(RENT_CHECKLIST).not.toContainEqual(item);
    }
    expect(templateForDealType("sale")).toBe(SALE_CHECKLIST);
  });

  it("GÖS adımları zorunluluk tarihi doğrulanana kadar 'duruma bağlı'dır (kapanış yüzdesini düşürmez)", () => {
    expect(GOS_CHECKLIST_ITEMS.every((i) => i.required === false)).toBe(true);
    expect(GOS_CHECKLIST_ITEMS.length).toBeGreaterThanOrEqual(4);
  });

  it("listede mükerrer etiket yok", () => {
    for (const list of [SALE_CHECKLIST, FOREIGN_SALE_CHECKLIST]) {
      const labels = list.map((i) => i.label.trim().toLocaleLowerCase("tr-TR"));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("dürüstlük: tarih kaynaklarda farklı notu, kaynak URL'leri ve 'para üründen geçmez'", () => {
    expect(GOS_DATE_NOTE).toMatch(/Tarih kaynaklarda farklı/);
    expect(GOS_DATE_NOTE).toMatch(/güncel resmi duyuruyu doğrulayın/);
    expect(GOS_SOURCES.length).toBeGreaterThanOrEqual(3);
    for (const s of GOS_SOURCES) expect(s.url).toMatch(/^https:\/\//);
    expect(GOS_NO_MONEY_NOTE).toMatch(/Para EmlakSoft'tan geçmez/);
    const all = [GOS_SUMMARY, GOS_CLAUSE_TEXT, GOS_NO_MONEY_NOTE, ...GOS_CHECKLIST_ITEMS.map((i) => i.label)].join("\n");
    expect(all).not.toMatch(/ödeme sistemimiz/i);
    // Kesin tek tarih iddiası yok: "zorunlu ... 1 Aralık" kalıbı sabit olgu olarak yazılmaz.
    expect(GOS_SUMMARY).not.toMatch(/1 Aralık|1 Ekim|1 Temmuz/);
  });

  it("sözleşme maddesi isteğe bağlı, idempotent ve yalnız satış/kapora türlerinde", () => {
    expect(GOS_CLAUSE_TEXT).toContain(GOS_CLAUSE_MARKER);
    expect(GOS_CLAUSE_TEXT).toMatch(/tahsil etmez, saklamaz veya devretmez/);
    const once = appendGosClause("TAŞINMAZ SATIM SÖZLEŞMESİ\nMADDE 1");
    expect(once).toContain(GOS_CLAUSE_MARKER);
    expect(appendGosClause(once)).toBe(once);
    expect(appendGosClause("")).toContain(GOS_CLAUSE_MARKER);
    expect(gosClauseApplies("satis")).toBe(true);
    expect(gosClauseApplies("kapora")).toBe(true);
    expect(gosClauseApplies("kira")).toBe(false);
  });

  it("Uyum sayfası kartı ve sözleşme formu tek kaynağa bağlı", () => {
    expect(read("src/app/app/uyum/page.tsx")).toContain("<GosCard />");
    expect(read("src/app/app/uyum/gos-card.tsx")).toContain('from "@/lib/gos-info"');
    expect(read("src/app/app/sozlesmeler/yeni/new-contract-form.tsx")).toContain("appendGosClause");
  });
});

describe("yabancıya satış rehberi (H5)", () => {
  it("ikamet izni kartı 200.000 USD eşiğini sabitten gösterir ve doğrulanmadı sayılır", () => {
    const card = FOREIGN_SALE_GUIDE.find((c) => /İkamet izni/.test(c.title));
    expect(card).toBeTruthy();
    expect(legalValue("residencePermitMinUsd")).toBe(200_000);
    expect(card!.body).toMatch(/200\.000/);
    expect(card!.body).toMatch(/16\.10\.2023/);
    expect(card!.constants).toContain("residencePermitMinUsd");
    expect(guideCardVerification(card!).verified).toBe(false);
  });

  it("vatandaşlık kartı metni sabitle uyumlu", () => {
    const card = FOREIGN_SALE_GUIDE.find((c) => /Vatandaşlık eşiği/.test(c.title))!;
    expect(card.title).toContain("400.000");
    expect(legalValue("citizenshipMinUsd")).toBe(400_000);
    expect(legalValue("citizenshipHoldYears")).toBe(3);
  });

  it("GÖS kartı tarih dürüstlük notunu taşır; her kartın 'verify' alanı dolu", () => {
    const gos = FOREIGN_SALE_GUIDE.find((c) => /GÖS/.test(c.title))!;
    expect(gos.body).toContain(GOS_DATE_NOTE);
    for (const c of FOREIGN_SALE_GUIDE) expect(c.verify.length).toBeGreaterThan(5);
  });
});
