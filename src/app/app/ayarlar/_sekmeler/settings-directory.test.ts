import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navLayoutFor } from "@/lib/nav-roles";
import { SETTINGS_DIRECTORY, foldTr, matchesSettingsQuery, visibleSettingsDirectory } from "./settings-directory";

const all = SETTINGS_DIRECTORY.flatMap((c) => c.items);

describe("ayarlar dizini (OA13)", () => {
  it("Ayarlar şeridindeki her sayfa dizinde bir karttır", () => {
    const hub = navLayoutFor("owner").dock.concat(navLayoutFor("owner").hubs).find((h) => h.id === "ayarlar");
    expect(hub).toBeTruthy();
    const hrefs = new Set(all.map((i) => i.href.split("?")[0]));
    for (const p of hub!.pages) {
      if (p.href === "/app/ayarlar") continue;
      expect(hrefs.has(p.href), p.href).toBe(true);
    }
  });

  it("her kartın sayfası var; kart adresleri tekil", () => {
    for (const i of all) {
      const path = i.href.split("?")[0]!;
      expect(existsSync(join(process.cwd(), "src/app", path, "page.tsx")), path).toBe(true);
    }
    expect(new Set(all.map((i) => i.href)).size).toBe(all.length);
  });

  it("arama Türkçe karakter ve büyük harf duyarsız, tüm sözcükleri arar", () => {
    expect(foldTr("Güvenlik İŞLEMİ")).toBe("guvenlik islemi");
    const guvenlik = all.find((i) => i.href === "/app/ayarlar/guvenlik")!;
    expect(matchesSettingsQuery(guvenlik, "2fa")).toBe(true);
    expect(matchesSettingsQuery(guvenlik, "GUVENLIK oturum")).toBe(true);
    expect(matchesSettingsQuery(guvenlik, "logo")).toBe(false);
    expect(matchesSettingsQuery(guvenlik, "  ")).toBe(true);
  });

  it("sahiplik devri yalnız ofis sahibine; modül izni olmayan kart gizlenir", () => {
    const owner = visibleSettingsDirectory("owner", () => true).flatMap((c) => c.items.map((i) => i.href));
    const gm = visibleSettingsDirectory("gm", (m) => m !== "billing").flatMap((c) => c.items.map((i) => i.href));
    expect(owner).toContain("/app/ayarlar/sahiplik-devri");
    expect(gm).not.toContain("/app/ayarlar/sahiplik-devri");
    expect(gm).not.toContain("/app/abonelik");
  });
});
