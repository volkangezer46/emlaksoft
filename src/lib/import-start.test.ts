import { describe, expect, it } from "vitest";
import { importBackLabel, importHref, parseImportTarget, resolveImportBack, returnPathFromReferer, safeAppReturnPath } from "./import-start";

const ALL = ["customers", "properties", "demands", "tasks", "appointments", "expenses", "rentals"] as const;

describe("içe aktarma girişi (C28)", () => {
  it("hedef: Türkçe ve iç ad kabul edilir, bilinmeyen null", () => {
    expect(parseImportTarget("portfoyler", ALL)).toBe("properties");
    expect(parseImportTarget("Musteriler", ALL)).toBe("customers");
    expect(parseImportTarget("demands", ALL)).toBe("demands");
    expect(parseImportTarget("yok", ALL)).toBeNull();
    expect(parseImportTarget(undefined, ALL)).toBeNull();
    expect(parseImportTarget("properties", ["customers"] as const)).toBeNull();
  });

  it("dönüş yolu yalnız uygulama içi; dış adres, // ve içe aktarmanın kendisi reddedilir", () => {
    expect(safeAppReturnPath("/app/portfoyler")).toBe("/app/portfoyler");
    expect(safeAppReturnPath("/app/baslangic?adim=veri")).toBe("/app/baslangic?adim=veri");
    for (const bad of ["https://kotu.example/app", "//kotu.example", "/appx", "/giris", "/app\\..", "/app/ice-aktarma", "/app/ice-aktarma?hedef=x", "", null])
      expect(safeAppReturnPath(bad), String(bad)).toBeNull();
  });

  it("Referer yalnız aynı alan adından", () => {
    expect(returnPathFromReferer("https://emlaksoft.com.tr/app/musteriler?q=a", "emlaksoft.com.tr")).toBe("/app/musteriler?q=a");
    expect(returnPathFromReferer("https://baska.site/app/musteriler", "emlaksoft.com.tr")).toBeNull();
    expect(returnPathFromReferer("bozuk", "emlaksoft.com.tr")).toBeNull();
  });

  it("Geri sırası: ?geri= > Referer > hedefin listesi > Müşteriler; 'Ayarlara dön' yok", () => {
    const host = "emlaksoft.com.tr";
    expect(resolveImportBack({ geri: "/app/portfoyler", referer: `https://${host}/app/musteriler`, host })).toBe("/app/portfoyler");
    expect(resolveImportBack({ referer: `https://${host}/app/musteriler`, host })).toBe("/app/musteriler");
    expect(resolveImportBack({ target: "properties" })).toBe("/app/portfoyler");
    expect(resolveImportBack({})).toBe("/app/musteriler");
    expect(importBackLabel("/app/portfoyler")).toBe("Portföylere dön");
    expect(importBackLabel("/app/baslangic?adim=veri")).toBe("Kuruluma dön");
    expect(importBackLabel("/app/raporlar")).toBe("Geri");
  });

  it("hedefli adres güvenli dönüşü taşır", () => {
    expect(importHref("customers", "/app/baslangic?adim=veri")).toBe("/app/ice-aktarma?hedef=customers&geri=%2Fapp%2Fbaslangic%3Fadim%3Dveri");
    expect(importHref("demands", "https://kotu.example")).toBe("/app/ice-aktarma?hedef=demands");
  });
});
