import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { homeShortcutItems } from "./shortcut-items";

/** F12 — ana ekran kısayol şeridi rolün menüsüne göre; gider tarihi Türkçe kısa biçim. */
const all = { customers: ["view"], properties: ["view"], commissions: ["view"] } as const;
const labels = (role: string, perms: Record<string, readonly string[]>) => homeShortcutItems(role, perms as never).map((i) => i.label);

describe("F12 kısayol şeridi", () => {
  it("ofis sahibi: üç merkez kısayolu", () => {
    expect(labels("owner", all)).toEqual(["Ara ve komut", "Müşteriler", "Portföyler", "Komisyon", "Tüm kısayollar"]);
  });
  it("yetkisi olmayan merkez yazılmaz", () => {
    expect(labels("owner", { customers: ["view"] })).toEqual(["Ara ve komut", "Müşteriler", "Tüm kısayollar"]);
  });
  it("çağrı merkezi ve muhasebe: menüsünde olmayan merkez yok", () => {
    for (const role of ["call_center", "accounting"]) {
      const l = labels(role, all);
      expect(l[0]).toBe("Ara ve komut");
      expect(l.at(-1)).toBe("Tüm kısayollar");
      expect(l.length).toBeLessThan(5);
    }
  });
  it("sayfa sabit liste değil, yardımcıyı kullanır; gider tarihi formatDateTr ile", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/app/(bugun)/page.tsx"), "utf8");
    expect(page).toContain("homeShortcutItems(role, perms)");
    expect(page).not.toMatch(/\{ keys: \["G", "M"\]/);
    const g = readFileSync(resolve(process.cwd(), "src/app/app/_home/gider-ozeti.tsx"), "utf8");
    expect(g).toContain("formatDateTr(r.expense_date, SHORT_DATE)");
    expect(g).not.toContain("{r.expense_date}</span>");
  });
});
